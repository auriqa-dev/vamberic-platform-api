import { z } from "zod";
import { platformIdPattern } from "../domain/ids";

export const notificationEmailSchema = z.string().trim().max(254).email();
const recipientMap = z.record(
  z.string().regex(platformIdPattern("product")),
  z.array(notificationEmailSchema).min(1).max(50),
);
export const notificationRecipientsSchema = z
  .string()
  .default("{}")
  .transform((text, ctx) => {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      /* Report only a fixed message below. */
    }
    const parsed = recipientMap.safeParse(value);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message:
          "must be a JSON object mapping valid Product IDs to 1–50 email addresses",
      });
      return z.NEVER;
    }
    return parsed.data;
  });

export interface NotificationConfig {
  enabled: boolean;
  region: string;
  from?: string;
  recipients: Record<string, string[]>;
}

/** Replace this resolver with Product Settings without changing enquiry logic. */
export interface NotificationRecipientResolver {
  resolve(
    productId: string,
    notificationType: "enquiry_submitted",
  ): Promise<readonly string[]>;
}
export class EnvironmentNotificationRecipients implements NotificationRecipientResolver {
  constructor(private readonly recipients: Record<string, string[]>) {}
  async resolve(productId: string): Promise<readonly string[]> {
    return [...(this.recipients[productId] ?? [])];
  }
}
