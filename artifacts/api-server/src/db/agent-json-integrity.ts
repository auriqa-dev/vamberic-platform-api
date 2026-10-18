import { z } from "zod";
import type { Document } from "mongodb";
import { operatingJsonByteSize } from "./operating-json-size";

export function utf16Length(path: string): Document {
  return {
    $add: [
      { $strLenCP: path },
      {
        $size: {
          $regexFindAll: { input: path, regex: "[\\x{10000}-\\x{10FFFF}]" },
        },
      },
    ],
  };
}
/** Bounded breadth-first JSON accounting, no server-side JS and no recursively
 * expanded JSON Schema. Object keys count as nodes just as Runtime preflight.
 * All dangerous expressions are guarded by type branches (Mongo $and need not
 * short circuit). Bytes match ECMAScript JSON serialization via existing helper. */
export function agentJsonIntegrity(
  path: string | Document,
  maximumBytes: number,
): Document {
  const n = "$$node";
  const strBytes = operatingJsonByteSize(z.string(), n);
  const numBytes = operatingJsonByteSize(z.number(), n);
  const children: Document = {
    $switch: {
      branches: [
        { case: { $eq: [{ $type: n }, "array"] }, then: n },
        {
          case: { $eq: [{ $type: n }, "object"] },
          then: {
            $map: {
              input: { $objectToArray: n },
              as: "entry",
              in: "$$entry.v",
            },
          },
        },
      ],
      default: [],
    },
  };
  const metrics: Document = {
    $switch: {
      branches: [
        {
          case: { $eq: [{ $type: n }, "string"] },
          then: {
            bytes: strBytes,
            nodes: 1,
            valid: { $lte: [utf16Length(n), 16000] },
          },
        },
        {
          case: { $eq: [{ $type: n }, "null"] },
          then: { bytes: 4, nodes: 1, valid: true },
        },
        {
          case: { $eq: [{ $type: n }, "bool"] },
          then: { bytes: { $cond: [n, 4, 5] }, nodes: 1, valid: true },
        },
        {
          case: { $in: [{ $type: n }, ["int", "long", "double"]] },
          then: {
            bytes: numBytes,
            nodes: 1,
            valid: {
              $and: [
                { $gte: [n, -Number.MAX_VALUE] },
                { $lte: [n, Number.MAX_VALUE] },
                {
                  $or: [
                    { $ne: [{ $trunc: n }, n] },
                    { $lte: [{ $abs: n }, Number.MAX_SAFE_INTEGER] },
                  ],
                },
                {
                  $not: [
                    {
                      $in: [
                        { $toString: n },
                        ["NaN", "Infinity", "-Infinity", "-0"],
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          case: { $eq: [{ $type: n }, "array"] },
          then: {
            bytes: {
              $add: [2, { $max: [0, { $subtract: [{ $size: n }, 1] }] }],
            },
            nodes: 1,
            valid: { $lte: [{ $size: n }, 256] },
          },
        },
        {
          case: { $eq: [{ $type: n }, "object"] },
          then: {
            $let: {
              vars: { entries: { $objectToArray: n } },
              in: {
                bytes: {
                  $add: [
                    2,
                    { $max: [0, { $subtract: [{ $size: "$$entries" }, 1] }] },
                    { $size: "$$entries" },
                    {
                      $sum: {
                        $map: {
                          input: "$$entries",
                          as: "entry",
                          in: operatingJsonByteSize(z.string(), "$$entry.k"),
                        },
                      },
                    },
                  ],
                },
                nodes: { $add: [1, { $size: "$$entries" }] },
                valid: {
                  $and: [
                    { $lte: [{ $size: "$$entries" }, 100] },
                    {
                      $allElementsTrue: [
                        {
                          $map: {
                            input: "$$entries",
                            as: "entry",
                            in: {
                              $and: [
                                {
                                  $not: [
                                    {
                                      $in: [
                                        "$$entry.k",
                                        [
                                          "__proto__",
                                          "constructor",
                                          "prototype",
                                        ],
                                      ],
                                    },
                                  ],
                                },
                                { $lte: [utf16Length("$$entry.k"), 16000] },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      ],
      default: { bytes: 0, nodes: 1, valid: false },
    },
  };
  const state = {
    $reduce: {
      input: { $range: [0, 13] },
      initialValue: { frontier: [path], bytes: 0, nodes: 0, valid: true },
      in: {
        $let: {
          vars: { previous: "$$value", depth: "$$this" },
          in: {
            $reduce: {
              input: "$$previous.frontier",
              initialValue: {
                frontier: [],
                bytes: "$$previous.bytes",
                nodes: "$$previous.nodes",
                valid: "$$previous.valid",
              },
              in: {
                $let: {
                  vars: { node: "$$this" },
                  in: {
                    $let: {
                      vars: { metrics, children },
                      in: {
                        frontier: {
                          $slice: [
                            {
                              $concatArrays: ["$$value.frontier", "$$children"],
                            },
                            20001,
                          ],
                        },
                        bytes: { $add: ["$$value.bytes", "$$metrics.bytes"] },
                        nodes: { $add: ["$$value.nodes", "$$metrics.nodes"] },
                        valid: {
                          $and: [
                            "$$value.valid",
                            "$$metrics.valid",
                            {
                              $lte: [
                                {
                                  $add: [
                                    { $size: "$$value.frontier" },
                                    { $size: "$$children" },
                                  ],
                                },
                                20000,
                              ],
                            },
                            {
                              $cond: [
                                { $eq: ["$$depth", 12] },
                                { $eq: [{ $size: "$$children" }, 0] },
                                true,
                              ],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };
  return {
    $let: {
      vars: { metrics: state },
      in: {
        $and: [
          "$$metrics.valid",
          { $lte: ["$$metrics.nodes", 20000] },
          { $lte: ["$$metrics.bytes", maximumBytes] },
          { $eq: [{ $size: "$$metrics.frontier" }, 0] },
        ],
      },
    },
  };
}
