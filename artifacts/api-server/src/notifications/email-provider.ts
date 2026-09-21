import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandOutput,
} from "@aws-sdk/client-ses";

export interface EmailMessage {
  to: readonly string[];
  from: string;
  subject: string;
  text: string;
  html?: string;
}
export interface EmailProvider {
  sendEmail(message: EmailMessage, signal?: AbortSignal): Promise<void>;
}
// Explicit vocabulary, not just a character/length check: even an error name
// can contain personal data. Unknown identifiers never pass through to logs.
const safeProviderErrorCodes = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "ConfigurationSetDoesNotExistException",
  "ConfigurationSetSendingPausedException",
  "AccountSendingPausedException",
  "FromEmailAddressNotVerifiedException",
  "AccessDenied",
  "AccessDeniedException",
  "InvalidClientTokenId",
  "UnrecognizedClientException",
  "SignatureDoesNotMatch",
  "ExpiredToken",
  "ExpiredTokenException",
  "CredentialsProviderError",
  "TokenProviderError",
  "InvalidParameterValue",
  "ValidationError",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
  "LimitExceededException",
  "ServiceUnavailable",
  "InternalFailure",
  "InternalServerError",
  "RequestExpired",
  "TimeoutError",
  "AbortError",
  "NetworkingError",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
]);
function safeCode(value: unknown): string | undefined {
  return typeof value === "string" && safeProviderErrorCodes.has(value)
    ? value
    : undefined;
}
function providerErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  try {
    const fields = error as { name?: unknown; code?: unknown };
    return safeCode(fields.name) ?? safeCode(fields.code);
  } catch {
    return undefined;
  }
}
export class EmailProviderError extends Error {
  readonly providerErrorCode: string;
  constructor(code?: string) {
    super("Email provider unavailable");
    this.name = "EmailProviderError";
    this.providerErrorCode = safeCode(code) ?? "UnknownProviderError";
  }
}
// Small transport seam for unit tests; no credentials or network are needed.
interface SesTransport {
  send(
    command: SendEmailCommand,
    options: { abortSignal?: AbortSignal },
  ): Promise<SendEmailCommandOutput>;
}
export class SesEmailProvider implements EmailProvider {
  private readonly client: SesTransport;
  constructor(region: string, client?: SesTransport) {
    // Use the standard runtime credential chain, including the ECS task role.
    // No automatic send retries: an ambiguous timeout must not duplicate mail.
    this.client = client ?? new SESClient({ region, maxAttempts: 1 });
  }
  async sendEmail(message: EmailMessage, signal?: AbortSignal): Promise<void> {
    try {
      await this.client.send(
        new SendEmailCommand({
          Source: message.from,
          Destination: { ToAddresses: [...message.to] },
          Message: {
            Subject: { Data: message.subject, Charset: "UTF-8" },
            Body: {
              Text: { Data: message.text, Charset: "UTF-8" },
              ...(message.html
                ? { Html: { Data: message.html, Charset: "UTF-8" } }
                : {}),
            },
          },
        }),
        { abortSignal: signal },
      );
    } catch (error) {
      // Retain only an allowlisted identifier, never the message, object or cause.
      throw new EmailProviderError(providerErrorCode(error));
    }
  }
}
