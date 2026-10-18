import type { IndexDescription } from "mongodb";
/** Additive, explicitly applied with the approved release; never auto-migrate at startup. */
export const WEBSITE_TRACKING_INDEXES: IndexDescription[] = [
  {
    name: "website_evidence_expiry",
    key: { "payload.website.expiresAt": 1 },
    partialFilterExpression: {
      eventType: "measurement_outcome",
      "payload.provider": "website",
    },
  },
  {
    name: "website_session_link_expiry",
    key: { eventType: 1, "payload.expiresAt": 1 },
    partialFilterExpression: {
      eventType: { $in: ["website_tracking_session", "website_tracking_link"] },
    },
  },
];
