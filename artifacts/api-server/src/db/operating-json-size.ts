import { z } from "zod";
import type { Document } from "mongodb";

// Match JSON.stringify of the schema-parsed domain record, not BSON storage
// overhead. Root _id and stripped unknown keys are deliberately not measured.
// No server-side JavaScript (which collection validators prohibit).
export function operatingJsonSize(
  schema: z.ZodTypeAny,
  maximum = 200000,
): Document {
  return { $lte: [operatingJsonByteSize(schema), maximum] };
}

export function operatingJsonByteSize(
  schema: z.ZodTypeAny,
  rootPath = "$$ROOT",
): Document | number {
  let serial = 0;
  const present = (path: string) => ({ $ne: [{ $type: path }, "missing"] });
  function size(s: z.ZodTypeAny, path: string): Document | number {
    if (s instanceof z.ZodEffects) return size(s._def.schema, path);
    if (s instanceof z.ZodDefault)
      return {
        $cond: [
          present(path),
          size(s._def.innerType, path),
          Buffer.byteLength(JSON.stringify(s._def.defaultValue())),
        ],
      };
    if (s instanceof z.ZodOptional) return size(s._def.innerType, path);
    if (s instanceof z.ZodNullable)
      return {
        $cond: [{ $eq: [path, null] }, 4, size(s._def.innerType, path)],
      };
    if (s instanceof z.ZodDiscriminatedUnion) {
      return {
        $switch: {
          branches: s.options.map((option: z.ZodObject<z.ZodRawShape>) => ({
            case: {
              $eq: [
                `${path}.${s.discriminator}`,
                (option.shape[s.discriminator] as z.ZodLiteral<string>).value,
              ],
            },
            then: size(option, path),
          })),
          default: Number.MAX_SAFE_INTEGER,
        },
      };
    }
    if (s instanceof z.ZodObject) {
      const terms: unknown[] = [];
      function objectTerms(
        object: z.ZodObject<z.ZodRawShape>,
        objectPath: string,
        optionalObject = false,
      ) {
        const exists = present(objectPath);
        const counts: unknown[] = [];
        terms.push(optionalObject ? { $cond: [exists, 2, 0] } : 2);
        for (const [key, child] of Object.entries(object.shape)) {
          const childPath = `${objectPath}.${key}`;
          const optional =
            child.isOptional() && !(child instanceof z.ZodDefault);
          const include = optional ? present(childPath) : exists;
          const conditional = optional || optionalObject;
          counts.push(conditional ? { $cond: [include, 1, 0] } : 1);
          let unwrapped = child;
          while (
            unwrapped instanceof z.ZodEffects ||
            unwrapped instanceof z.ZodOptional
          )
            unwrapped =
              unwrapped instanceof z.ZodEffects
                ? unwrapped._def.schema
                : unwrapped._def.innerType;
          const overhead = Buffer.byteLength(JSON.stringify(key)) + 1;
          terms.push(
            conditional ? { $cond: [include, overhead, 0] } : overhead,
          );
          if (unwrapped instanceof z.ZodObject)
            objectTerms(unwrapped, childPath, conditional);
          else
            terms.push(
              conditional
                ? { $cond: [include, size(child, childPath), 0] }
                : size(child, childPath),
            );
        }
        terms.push({ $max: [0, { $subtract: [{ $add: counts }, 1] }] });
      }
      objectTerms(s, path);
      return { $add: terms };
    }
    if (s instanceof z.ZodArray) {
      const variable = `element${serial++}`;
      const input = { $cond: [{ $isArray: path }, path, []] };
      return {
        $add: [
          2,
          { $max: [0, { $subtract: [{ $size: input }, 1] }] },
          {
            $sum: {
              $map: {
                input,
                as: variable,
                in: size(s.element, `$$${variable}`),
              },
            },
          },
        ],
      };
    }
    if (s instanceof z.ZodDate)
      return {
        $cond: [
          { $eq: [{ $type: path }, "date"] },
          {
            $cond: [
              {
                $and: [
                  { $gte: [{ $year: path }, 0] },
                  { $lte: [{ $year: path }, 9999] },
                ],
              },
              26,
              29,
            ],
          },
          0,
        ],
      };
    if (s instanceof z.ZodBoolean)
      return { $cond: [{ $eq: [path, true] }, 4, 5] };
    if (s instanceof z.ZodLiteral)
      return Buffer.byteLength(JSON.stringify(s.value));
    if (s instanceof z.ZodEnum || s instanceof z.ZodString) {
      let value: Document | string = {
        $cond: [{ $eq: [{ $type: path }, "string"] }, path, ""],
      };
      if (s instanceof z.ZodString)
        for (const check of s._def.checks) {
          if (check.kind === "trim")
            value = {
              $trim: {
                input: value,
                chars:
                  "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff",
              },
            };
          if (check.kind === "toUpperCase") value = { $toUpper: value };
        }
      return {
        $let: {
          vars: { text: value },
          in: {
            $add: [
              2,
              { $strLenBytes: "$$text" },
              {
                $sum: {
                  $map: {
                    input: {
                      $regexFindAll: {
                        input: "$$text",
                        regex: '[\\x00-\\x1f"\\\\]',
                      },
                    },
                    as: "escape",
                    in: {
                      $cond: [
                        {
                          $in: [
                            "$$escape.match",
                            ['"', "\\", "\b", "\f", "\n", "\r", "\t"],
                          ],
                        },
                        1,
                        5,
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      };
    }
    if (s instanceof z.ZodNumber) {
      const text = {
        $convert: { input: path, to: "string", onError: "0", onNull: "0" },
      };
      const pieces = { $split: [text, "e"] };
      const coefficient = { $arrayElemAt: [pieces, 0] };
      const exponent = {
        $convert: {
          input: { $arrayElemAt: [pieces, 1] },
          to: "int",
          onError: 0,
          onNull: 0,
        },
      };
      const add = (...values: unknown[]): Document => ({ $add: values });
      return {
        $let: {
          vars: {
            text,
            exponent,
            width: add(exponent, 1),
            sign: { $cond: [{ $lt: [path, 0] }, 1, 0] },
            digits: {
              $strLenBytes: {
                $replaceAll: {
                  input: {
                    $replaceAll: {
                      input: coefficient,
                      find: "-",
                      replacement: "",
                    },
                  },
                  find: ".",
                  replacement: "",
                },
              },
            },
          },
          in: {
            $switch: {
              branches: [
                { case: { $eq: [path, 0] }, then: 1 },
                {
                  case: {
                    $not: [{ $regexMatch: { input: "$$text", regex: "e" } }],
                  },
                  then: { $strLenBytes: "$$text" },
                },
                {
                  case: {
                    $and: [
                      { $gte: ["$$exponent", 0] },
                      { $lt: ["$$exponent", 21] },
                    ],
                  },
                  then: add(
                    "$$sign",
                    { $max: ["$$digits", "$$width"] },
                    { $cond: [{ $gt: ["$$digits", "$$width"] }, 1, 0] },
                  ),
                },
                {
                  case: {
                    $and: [
                      { $gte: ["$$exponent", -6] },
                      { $lt: ["$$exponent", 0] },
                    ],
                  },
                  then: add(
                    "$$sign",
                    1,
                    { $multiply: [-1, "$$exponent"] },
                    "$$digits",
                  ),
                },
              ],
              default: add(
                "$$sign",
                "$$digits",
                { $cond: [{ $gt: ["$$digits", 1] }, 1, 0] },
                1,
                { $cond: [{ $gte: ["$$exponent", 0] }, 1, 0] },
                { $strLenBytes: { $toString: "$$exponent" } },
              ),
            },
          },
        },
      };
    }
    throw new Error("Unsupported operating JSON size type");
  }
  return size(schema, rootPath);
}
