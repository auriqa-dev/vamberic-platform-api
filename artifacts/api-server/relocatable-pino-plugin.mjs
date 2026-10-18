import esbuildPluginPino from "esbuild-plugin-pino";

// Existing ESM banners set __dirname from each entrypoint's import.meta.url.
// Capture that location when Pino initializes, instead of the build host path.
export function relocatablePinoPlugin(options) {
  const plugin = esbuildPluginPino(options);
  return {
    name: "relocatable-pino",
    async setup(build) {
      await plugin.setup({
        ...build,
        onLoad(filter, callback) {
          build.onLoad(filter, async (args) => {
            const result = await callback(args);
            if (!result) return result;
            const expected = `const outputDir = ${JSON.stringify(build.initialOptions.outdir)};`;
            if (
              typeof result.contents !== "string" ||
              result.contents.split(expected).length !== 2
            ) {
              throw new Error("Pino worker relocation contract changed");
            }
            return {
              ...result,
              contents: result.contents.replace(
                expected,
                "const outputDir = globalThis.__dirname;",
              ),
            };
          });
        },
      });
    },
  };
}
