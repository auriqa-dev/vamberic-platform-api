import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "node:crypto";
import { platformIdSchema } from "../../domain";
export interface LushaSecrets {
  create(workspaceId: string, key: string): Promise<string>;
  read(workspaceId: string, reference: string): Promise<string>;
  remove(workspaceId: string, reference: string): Promise<void>;
}
export function createLushaSecrets(): LushaSecrets | undefined {
  const prefix = process.env.HVM_LUSHA_SECRET_PREFIX;
  if (!prefix || !/^hvm\/(dev|staging|prod)\/lusha\/$/.test(prefix))
    return undefined;
  const client = new SecretsManagerClient({});
  function validate(w: string, arn: string) {
    platformIdSchema("workspace").parse(w);
    if (
      !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:/.test(arn) ||
      !arn.split(":secret:")[1]?.startsWith(`${prefix}${w}/`)
    )
      throw new Error("Credential unavailable");
  }
  return {
    async create(w, key) {
      platformIdSchema("workspace").parse(w);
      const r = await client.send(
        new CreateSecretCommand({
          Name: `${prefix}${w}/${randomUUID()}`,
          SecretString: JSON.stringify({ workspaceId: w, apiKey: key }),
          Tags: [
            { Key: "hvm-workspace", Value: w },
            { Key: "hvm-provider", Value: "lusha" },
          ],
        }),
      );
      if (!r.ARN) throw new Error("Credential unavailable");
      return r.ARN;
    },
    async read(w, arn) {
      validate(w, arn);
      const r = await client.send(new GetSecretValueCommand({ SecretId: arn }));
      const value = JSON.parse(r.SecretString ?? "{}");
      if (value.workspaceId !== w || typeof value.apiKey !== "string")
        throw new Error("Credential unavailable");
      return value.apiKey;
    },
    async remove(w, arn) {
      validate(w, arn);
      await client.send(
        new DeleteSecretCommand({ SecretId: arn, RecoveryWindowInDays: 7 }),
      );
    },
  };
}
