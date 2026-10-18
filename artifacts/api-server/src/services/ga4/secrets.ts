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
import type { GoogleConfig } from "../mailbox/google";
import { Ga4Error } from "./google";
export interface Ga4Secrets {
  create(w: string, value: unknown): Promise<string>;
  read(w: string, arn: string): Promise<unknown>;
  write(w: string, arn: string, value: unknown): Promise<void>;
  remove(w: string, arn: string): Promise<void>;
  config(): Promise<GoogleConfig>;
}
export function ga4Secrets(): Ga4Secrets | undefined {
  const prefix = process.env.HVM_GA4_SECRET_PREFIX,
    clientArn = process.env.HVM_GA4_CLIENT_SECRET_ARN,
    redirectUri = process.env.HVM_GA4_REDIRECT_URI;
  if (!prefix && !clientArn && !redirectUri) return undefined;
  if (!prefix || !clientArn || !redirectUri)
    throw new Error("Incomplete ga4 configuration");
  if (
    !/^hvm\/(dev|staging|prod)\/ga4\/$/.test(prefix) ||
    !/^arn:aws:secretsmanager:[a-z0-9-]+:\d{12}:secret:hvm\/(dev|staging|prod)\/ga4-client-/.test(
      clientArn,
    )
  )
    throw new Error("Invalid ga4 configuration");
  const uri = new URL(redirectUri);
  if (
    uri.protocol !== "https:" ||
    uri.pathname !== "/ga4-callback.html" ||
    uri.search ||
    uri.hash ||
    uri.username ||
    uri.password
  )
    throw new Error("Invalid ga4 callback");
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
      throw new Ga4Error(
        "SECRET_UNAVAILABLE",
        "GA4 credentials are unavailable. Reconnect GA4.",
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
            { Key: "hvm-provider", Value: "ga4" },
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
