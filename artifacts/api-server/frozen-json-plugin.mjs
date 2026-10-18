import { readFile } from "node:fs/promises";
/** Keep immutable validator snapshots as data, avoiding enormous generated JS
 * object ASTs in the bundled command/API. No change to parsed definitions. */
export function frozenJsonPlugin() {
  return {
    name: "frozen-validator-data",
    setup(builder) {
      builder.onLoad(
        { filter: /frozen-v[0-9]+-(?:target|validators)\.json$/ },
        async ({ path }) => ({
          contents: `export default JSON.parse(${JSON.stringify(JSON.stringify(JSON.parse(await readFile(path, "utf8"))))});`,
          loader: "js",
        }),
      );
    },
  };
}
