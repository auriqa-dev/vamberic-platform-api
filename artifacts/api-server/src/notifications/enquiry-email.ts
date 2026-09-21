/** Explicit completed-enquiry context, never a request or raw CRM document. */
export interface EnquirySubmittedNotification {
  type: "enquiry_submitted";
  productId: string;
  productName: string;
  personName: string;
  workEmail: string;
  company: string;
  website?: string;
  jobTitle?: string;
  serviceInterest?: string;
  message: string;
  opportunityId: string;
  eventId: string;
  source?: string;
  medium?: string;
  campaign?: string;
  occurredAt: Date;
}

// Remove control characters and prevent submitted scalar fields spoofing new
// lines/headers. Message remains plain text and preserves normal line breaks.
function clean(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0)!;
      return (
        code >= 32 &&
        !(code >= 127 && code <= 159) &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069)
      );
    })
    .join("");
}
function line(value?: string): string {
  return value ? clean(value.replace(/\s+/g, " ")).trim() : "Not supplied";
}
export function renderEnquiryEmail(context: EnquirySubmittedNotification): {
  subject: string;
  text: string;
} {
  return {
    subject:
      `New enquiry — ${line(context.productName)} — ${line(context.company)}`.slice(
        0,
        200,
      ),
    text: [
      "New enquiry received",
      "",
      `Product: ${line(context.productName)}`,
      `Name: ${line(context.personName)}`,
      `Company: ${line(context.company)}`,
      `Work email: ${line(context.workEmail)}`,
      `Role: ${line(context.jobTitle)}`,
      `Website: ${line(context.website)}`,
      `Service interest: ${line(context.serviceInterest)}`,
      "",
      "Message:",
      ...context.message
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((text) => `  ${clean(text)}`),
      "",
      "Attribution:",
      `Source: ${line(context.source)}`,
      `Medium: ${line(context.medium)}`,
      `Campaign: ${line(context.campaign)}`,
      "",
      `Opportunity ID: ${line(context.opportunityId)}`,
      `Received: ${context.occurredAt.toISOString()} (UTC)`,
    ].join("\n"),
  };
}
