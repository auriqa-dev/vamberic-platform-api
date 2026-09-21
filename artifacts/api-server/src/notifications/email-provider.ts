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
export class EmailProviderError extends Error {
  constructor() {
    super("Email provider unavailable");
    this.name = "EmailProviderError";
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
    } catch {
      // Do not retain a cause: SDK errors may contain addresses or request data.
      throw new EmailProviderError();
    }
  }
}
