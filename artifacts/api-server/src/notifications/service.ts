import { z } from "zod";
import { logger } from "../lib/logger";
import {
  EnvironmentNotificationRecipients,
  notificationEmailSchema,
  type NotificationConfig,
  type NotificationRecipientResolver,
} from "./config";
import { SesEmailProvider, type EmailProvider } from "./email-provider";
import {
  renderEnquiryEmail,
  type EnquirySubmittedNotification,
} from "./enquiry-email";

export type NotificationResult =
  | { status: "sent" }
  | { status: "skipped"; reason: "disabled" | "no_recipients" }
  | { status: "failed"; reason: "delivery_failed" | "timeout" };
export interface NotificationService {
  notify(context: EnquirySubmittedNotification): Promise<NotificationResult>;
}
export interface NotificationLogger {
  info(fields: Record<string, string>, message: string): void;
  warn(fields: Record<string, string>, message: string): void;
}
export interface NotificationDependencies {
  provider?: EmailProvider;
  recipients?: NotificationRecipientResolver;
  logger?: NotificationLogger;
  /** Test seam; runtime always uses the five-second deadline. */
  timeoutMs?: number;
}
export function createNotificationService(
  config: NotificationConfig,
  dependencies: NotificationDependencies = {},
): NotificationService {
  const log = dependencies.logger ?? logger;
  const recipients =
    dependencies.recipients ??
    new EnvironmentNotificationRecipients(config.recipients);
  // Disabled environments never construct an AWS client or resolve credentials.
  const provider = config.enabled
    ? (dependencies.provider ?? new SesEmailProvider(config.region))
    : undefined;
  return {
    async notify(context) {
      const fields = {
        productId: context.productId,
        notificationType: context.type,
        eventId: context.eventId,
      };
      const report = (result: NotificationResult): NotificationResult => {
        const data = {
          ...fields,
          status: result.status,
          ...(result.status !== "sent" ? { reason: result.reason } : {}),
        };
        // Logging must not turn a committed enquiry into an error either.
        try {
          if (result.status === "sent")
            log.info(data, "Notification accepted by email provider");
          else log.warn(data, "Notification not sent");
        } catch {
          /* Observability cannot change persistence semantics. */
        }
        return result;
      };
      if (!config.enabled)
        return report({ status: "skipped", reason: "disabled" });
      const controller = new AbortController();
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error("Notification deadline"));
          }, dependencies.timeoutMs ?? 5000);
        });
        const delivery = async (): Promise<NotificationResult> => {
          const to = [
            ...new Set(
              z
                .array(notificationEmailSchema)
                .max(50)
                .parse(
                  await recipients.resolve(context.productId, context.type),
                ),
            ),
          ];
          if (controller.signal.aborted)
            return { status: "failed", reason: "timeout" };
          if (!to.length) return { status: "skipped", reason: "no_recipients" };
          const from = notificationEmailSchema.parse(config.from);
          if (!provider) throw new Error("Notification provider unavailable");
          await provider.sendEmail(
            { to, from, ...renderEnquiryEmail(context) },
            controller.signal,
          );
          return { status: "sent" };
        };
        return report(await Promise.race([delivery(), timeout]));
      } catch {
        return report({
          status: "failed",
          reason: timedOut ? "timeout" : "delivery_failed",
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
