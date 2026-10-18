import {
  SecretsManagerClient,
  CreateSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { platformIdSchema } from "../../domain";
import { MailboxError, type GoogleConfig } from "./google";
export interface MailboxSecrets {
  create(w: string, value: unknown): Promise<string>;
  read(w: string, arn: string): Promise<unknown>;
  write(w: string, arn: string, value: unknown): Promise<void>;
  remove(w: string, arn: string): Promise<void>;
  config(): Promise<GoogleConfig>;
}
export function mailboxSecrets(): MailboxSecrets | undefined {
  const prefix = process.env.HVM_MAILBOX_SECRET_PREFIX,
    clientArn = process.env.HVM_GMAIL_CLIENT_SECRET_ARN,
    redirectUri = process.env.HVM_GMAIL_REDIRECT_URI;
  if (!prefix && !clientArn && !redirectUri) return undefined;
  if (!prefix || !clientArn || !redirectUri)
    throw new Error("Incomplete mailbox configuration");
  if (
    !/^hvm\/(dev|staging|prod)\/mailbox\/$/.test(prefix) ||
    !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:hvm\/(dev|staging|prod)\/gmail-client-/.test(
      clientArn,
    )
  )
    throw new Error("Invalid mailbox configuration");
  const uri = new URL(redirectUri);
  if (
    uri.protocol !== "https:" ||
    uri.pathname !== "/mailbox-callback.html" ||
    uri.search ||
    uri.hash ||
    uri.username ||
    uri.password
  )
    throw new Error("Invalid mailbox callback");
  const client = new SecretsManagerClient({
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 10000 },
  });
  function check(w: string, arn: string) {
    platformIdSchema("workspace").parse(w);
    if (
      !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:/.test(arn) ||
      !arn.split(":secret:")[1]?.startsWith(`${prefix}${w}/`)
    )
      throw new MailboxError(
        "SECRET_UNAVAILABLE",
        "Mailbox credentials are unavailable. Reconnect Gmail.",
      );
  }
  return {
    async create(w, value) {
      platformIdSchema("workspace").parse(w);
      const r = await client.send(
        new CreateSecretCommand({
          Name: `${prefix}${w}/${randomUUID()}`,
          SecretString: JSON.stringify({ workspaceId: w, value }),
          Tags: [
            { Key: "hvm-workspace", Value: w },
            { Key: "hvm-provider", Value: "gmail" },
          ],
        }),
      );
      if (!r.ARN) throw new Error("Secret storage unavailable");
      return r.ARN;
    },
    async read(w, arn) {
      check(w, arn);
      const r = await client.send(new GetSecretValueCommand({ SecretId: arn }));
      const v = JSON.parse(r.SecretString ?? "{}");
      if (v.workspaceId !== w) throw new Error("Credential scope mismatch");
      return v.value;
    },
    async write(w, arn, value) {
      check(w, arn);
      await client.send(
        new PutSecretValueCommand({
          SecretId: arn,
          SecretString: JSON.stringify({ workspaceId: w, value }),
        }),
      );
    },
    async remove(w, arn) {
      check(w, arn);
      await client.send(
        new DeleteSecretCommand({ SecretId: arn, RecoveryWindowInDays: 7 }),
      );
    },
    async config() {
      const r = await client.send(
        new GetSecretValueCommand({ SecretId: clientArn }),
      );
      const v = z
        .object({
          clientId: z.string().endsWith(".apps.googleusercontent.com"),
          clientSecret: z.string().min(1),
        })
        .parse(JSON.parse(r.SecretString ?? "{}"));
      return { ...v, redirectUri };
    },
  };
}
