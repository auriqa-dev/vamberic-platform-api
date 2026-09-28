import { readFile } from "node:fs/promises";
import { loadConfig } from "../config";
import { MongoClientService } from "../services/mongo";
import { provisionHvmClient } from "../services/hvm-provision";
const args = process.argv.slice(2);
if (args.length !== 3 || args[0] !== "--input" || args[2] !== "--apply") {
  console.error(
    "Usage: hvm:provision --input <reviewed-json-file> --apply (operator only; requires secure dev loader)",
  );
  process.exitCode = 2;
} else {
  let mongo: MongoClientService | undefined;
  try {
    const config = loadConfig();
    if (config.deploymentEnvironment !== "dev") throw new Error("Dev only");
    const input = JSON.parse(await readFile(args[1], "utf8"));
    mongo = new MongoClientService(config.mongodbUri);
    const result = await provisionHvmClient(
      mongo,
      input,
      config.cognito.issuer,
    );
    console.log(JSON.stringify(result));
  } catch {
    console.error(
      "Provisioning failed safely; inspect configuration and reviewed inputs. No automatic retry.",
    );
    process.exitCode = 1;
  } finally {
    await mongo?.close();
  }
}
