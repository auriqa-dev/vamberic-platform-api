import { z } from "zod";
import {
  digest,
  PRODUCT_CLARIFICATION_MANIFEST,
  PRODUCT_WEBSITE_MANIFEST,
  PSU_WEBSITE_POLICY_DIGEST,
} from "@workspace/agent-runtime-protocol";
import { TERMINAL_QUALIFICATION_DIGEST } from "./psu-terminal-qualification";
import { PSU_RECONCILIATION_POLICY_DIGEST } from "./product-service-understanding/execution-policy";

/** Static security pins; the assigned task-definition revision is deliberately absent. */
export const PsuStaticConfigurationSchema = z.strictObject({
  schemaVersion: z.literal(2),
  enabled: z.literal(true),
  region: z
    .string()
    .regex(/^[a-z]{2}-[a-z]+-[0-9]+$/)
    .max(32),
  account: z.string().regex(/^[0-9]{12}$/),
  release: z.strictObject({
    environment: z.literal("dev"),
    workloadClass: z.literal("agent_runtime"),
    workloadClientId: z.string().min(1).max(256),
    manifestDigest: z.enum([
      PRODUCT_CLARIFICATION_MANIFEST.manifestDigest,
      PRODUCT_WEBSITE_MANIFEST.manifestDigest,
    ]),
    buildDigest: z.enum([
      PRODUCT_CLARIFICATION_MANIFEST.buildDigest,
      PRODUCT_WEBSITE_MANIFEST.buildDigest,
    ]),
    policyDigest: z.enum([
      PSU_RECONCILIATION_POLICY_DIGEST,
      PSU_WEBSITE_POLICY_DIGEST,
    ]),
    serviceArn: z.string().max(256),
    taskDefinitionFamily: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
    imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  }),
  secretArn: z
    .string()
    .max(512)
    .regex(
      /^arn:aws:secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:vamberic\/dev\/[A-Za-z0-9/_-]+$/,
    ),
  models: z.strictObject({
    OPENAI_PROJECT_ID: z.string().regex(/^proj_[A-Za-z0-9_-]{1,150}$/),
    PSU_MAKER_MODEL: z.literal("gpt-6.1-sol"),
    PSU_EVALUATOR_MODEL: z.literal("gpt-6-astra"),
    PSU_REVISION_MODEL: z.literal("gpt-6.1-sol"),
  }),
});
/** A non-secret static pin, never evidence of provider qualification or authority. */
export const PsuStartupBindingSchema = z.strictObject({
  schemaVersion: z.literal(2),
  qualificationDigest: z.literal(TERMINAL_QUALIFICATION_DIGEST),
  specification: PsuStaticConfigurationSchema,
  specificationDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export function validatePsuSpecification(value: unknown) {
  const config = PsuStaticConfigurationSchema.parse(value);
  const website =
    config.release.manifestDigest === PRODUCT_WEBSITE_MANIFEST.manifestDigest;
  if (
    config.release.buildDigest !==
      (website ? PRODUCT_WEBSITE_MANIFEST : PRODUCT_CLARIFICATION_MANIFEST)
        .buildDigest ||
    config.release.policyDigest !==
      (website ? PSU_WEBSITE_POLICY_DIGEST : PSU_RECONCILIATION_POLICY_DIGEST)
  )
    throw new Error("Mixed PSU release pins");
  const prefix = `arn:aws:ecs:${config.region}:${config.account}:`;
  if (
    !config.release.serviceArn.startsWith(prefix) ||
    !/^service\/[A-Za-z0-9_-]{1,255}\/[A-Za-z0-9_-]{1,255}$/.test(
      config.release.serviceArn.slice(prefix.length),
    ) ||
    !config.secretArn.startsWith(
      `arn:aws:secretsmanager:${config.region}:${config.account}:secret:vamberic/dev/`,
    )
  )
    throw new Error("Invalid PSU specification");
  return config;
}
export function parsePsuStaticBinding(text: string) {
  try {
    if (text.length > 4096) throw new Error();
    const binding = PsuStartupBindingSchema.parse(JSON.parse(text));
    validatePsuSpecification(binding.specification);
    if (binding.specificationDigest !== digest(binding.specification))
      throw new Error();
    return binding;
  } catch {
    throw new Error("Invalid PSU qualification binding");
  }
}
/** Check the separately approved API release against static pins. Revision remains an API-only exact pin. */
export function parsePsuStartupBinding(text: string, release: unknown) {
  try {
    const binding = parsePsuStaticBinding(text);
    const config = binding.specification;
    const resolved = z
      .object({ taskDefinitionArn: z.string().max(256) })
      .parse(release);
    const prefix = `arn:aws:ecs:${config.region}:${config.account}:task-definition/${config.release.taskDefinitionFamily}:`;
    const revision = resolved.taskDefinitionArn.slice(prefix.length);
    if (
      !resolved.taskDefinitionArn.startsWith(prefix) ||
      !/^[1-9][0-9]{0,9}$/.test(revision) ||
      Number(revision) > 2147483647
    )
      throw new Error();
    const staticRelease = Object.fromEntries(
      Object.entries(config.release).filter(
        ([key]) => key !== "taskDefinitionFamily",
      ),
    );
    if (
      digest(release) !==
      digest({
        ...staticRelease,
        taskDefinitionArn: resolved.taskDefinitionArn,
      })
    )
      throw new Error();
    return { ...binding, projectReference: config.models.OPENAI_PROJECT_ID };
  } catch {
    throw new Error("Invalid PSU qualification binding");
  }
}
