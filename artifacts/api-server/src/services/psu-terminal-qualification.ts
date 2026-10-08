import { digest } from "@workspace/agent-runtime-protocol";
export const TERMINAL_POLICY_VERSION = "openai_responses_sync_terminal_v1";
/** Separate qualification pin. This does not enable either production composition. */
export const TERMINAL_QUALIFICATION = Object.freeze({
  key: "psu_openai_terminal_qualification_v1",
  version: 1,
  terminalContract: TERMINAL_POLICY_VERSION,
  reconciliationPolicy:
    "bf3ed982f350171956890c653bc26661052692fc9d6e90d9152f3e955452668b",
  transport: "https://api.openai.com/v1/responses",
  store: false,
  background: false,
  stream: false,
  retries: 0,
  modelIdentity: "exact",
  incompleteReasons: ["max_output_tokens", "content_filter"],
  httpErrorTerminal: false,
});
export const TERMINAL_QUALIFICATION_DIGEST = digest(TERMINAL_QUALIFICATION);
/** Explicit code-owned qualification, not startup activation or arbitrary contract configuration. */
export function openAITerminalQualification(projectReference: string) {
  if (!/^proj_[A-Za-z0-9_-]{1,251}$/.test(projectReference))
    throw new Error("Invalid qualification project");
  return Object.freeze({
    projectReference,
    terminalContracts: Object.freeze([TERMINAL_POLICY_VERSION]),
    qualificationDigest: TERMINAL_QUALIFICATION_DIGEST,
  });
}
