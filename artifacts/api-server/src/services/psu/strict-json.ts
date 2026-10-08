/** Parse bounded provider JSON without duplicate keys (including escaped aliases).
 * JSON.parse validates scalar grammar; this walker validates object-key uniqueness first.
 * No input text is included in errors. */
export function parseProviderJson(text: string): unknown {
  let at = 0;
  const fail = (): never => {
    throw new Error("Invalid provider JSON");
  };
  const space = () => {
    while (/[\t\n\r ]/.test(text[at] ?? "x")) at++;
  };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === "\\") at++;
      else if (c === '"') return JSON.parse(text.slice(start, at)) as string;
    }
    return fail();
  };
  const value = (depth: number): void => {
    if (depth > 64) fail();
    space();
    const c = text[at];
    if (c === '"') {
      string();
      return;
    }
    if (c === "{" || c === "[") {
      at++;
      space();
      const end = c === "{" ? "}" : "]";
      const keys = new Set<string>();
      if (text[at] === end) {
        at++;
        return;
      }
      for (;;) {
        space();
        if (c === "{") {
          if (text[at] !== '"') fail();
          const key = string();
          if (keys.has(key)) fail();
          keys.add(key);
          space();
          if (text[at++] !== ":") fail();
        }
        value(depth + 1);
        space();
        const sep = text[at++];
        if (sep === end) return;
        if (sep !== ",") fail();
      }
    }
    const start = at;
    while (at < text.length && !/[\s,\]}]/.test(text[at]!)) at++;
    if (at === start) fail();
    const scalar: unknown = JSON.parse(text.slice(start, at));
    if (
      scalar !== null &&
      typeof scalar !== "number" &&
      typeof scalar !== "boolean"
    )
      fail();
  };
  value(0);
  space();
  if (at !== text.length) fail();
  return JSON.parse(text) as unknown;
}
