/** Deliberately narrow projections; never carry an AWS error or its message. */
export interface SafeSesDiagnostics {
  readonly providerHttpStatus?: number;
  readonly providerRequestId?: string;
  readonly deniedAction?: "ses:SendEmail";
  readonly deniedResource?: string;
  readonly deniedPrincipal?: string;
}
function field(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}
function unquote(value: string): string {
  const quote = value[0];
  return ['"', "'", "`"].includes(quote) && value.endsWith(quote)
    ? value.slice(1, -1)
    : value;
}
// An SES identity may be an email address. Keep domain identities only: no @,
// percent-encoding, paths, wildcards or arbitrary resource types/names.
const domainIdentity =
  /^arn:aws:ses:[a-z]{2}(?:-[a-z]+)+-\d:\d{12}:identity\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// ECS sessions use hex task IDs. Do not retain arbitrary session names, which
// may contain emails, personal names or tokens. No account/role is hard-coded.
const ecsPrincipal =
  /^arn:aws:sts::\d{12}:assumed-role\/[A-Za-z0-9_-]{1,64}\/[a-f0-9]{32}$/;
const requestId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function extractSesDiagnostics(
  error: unknown,
  code: string,
): Readonly<SafeSesDiagnostics> {
  const result: {
    providerHttpStatus?: number;
    providerRequestId?: string;
    deniedAction?: "ses:SendEmail";
    deniedResource?: string;
    deniedPrincipal?: string;
  } = {};
  const metadata = field(error, "$metadata");
  const status = field(metadata, "httpStatusCode");
  if (
    typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
  )
    result.providerHttpStatus = status;
  const id = field(metadata, "requestId");
  if (typeof id === "string" && id.length === 36 && requestId.test(id))
    result.providerRequestId = id;

  if (code === "AccessDenied" || code === "AccessDeniedException") {
    const message = field(error, "message");
    // Recognise only the standard denial sentence. Do not scan arbitrary prose
    // for action names/ARNs, and never preserve the trailing explanation.
    if (
      typeof message === "string" &&
      message.length <= 4096 &&
      !/[\r\n]/.test(message)
    ) {
      const match =
        /^User:? (\S+) is not authorized to perform:? (\S+) on resource:? (\S+)(?: because [^\r\n]*)?$/.exec(
          message,
        );
      if (match) {
        const principal = unquote(match[1]);
        const action = unquote(match[2]);
        const resource = unquote(match[3]);
        if (action === "ses:SendEmail") result.deniedAction = action;
        if (resource.length <= 320 && domainIdentity.test(resource))
          result.deniedResource = resource;
        if (ecsPrincipal.test(principal)) result.deniedPrincipal = principal;
      }
    }
  }
  return Object.freeze(result);
}
