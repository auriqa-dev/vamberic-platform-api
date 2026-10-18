import { z } from "zod";
export const henrySections = [
  "overview",
  "understanding",
  "offers",
  "icp",
  "contact-strategy",
  "content-strategy",
  "library",
  "email-content",
  "communications",
  "interactions",
  "research",
  "campaigns",
  "performance",
  "nba",
  "contacts",
  "brand",
  "setup",
  "integrations",
  "team",
  "billing",
  "activity",
] as const;
export const henrySection = z.enum(henrySections);
export const henryField = z
  .object({
    key: z.string().min(1).max(160),
    label: z.string().max(200),
    value: z.string().max(30000),
  })
  .strict();
export const henryEditor = z
  .object({
    key: z.string().min(1).max(300),
    title: z.string().max(200),
    fields: z.array(henryField).max(160),
  })
  .strict();
export const workspaceHenryReply = z
  .object({
    reply: z.string().min(1).max(12000),
    objective: z.string().max(2000),
    destination: henrySection.nullable(),
    actionId: z.string().max(160),
    changes: z
      .array(
        z
          .object({
            key: z.string().max(160),
            value: z.string().max(30000),
            reason: z.string().max(1000),
          })
          .strict(),
      )
      .max(160),
  })
  .strict();
export const henryScreen = z
  .object({
    section: henrySection,
    brandId: z.string().max(100),
    summary: z.string().max(18000),
    editor: henryEditor.nullable(),
    actions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(160),
            label: z.string().max(200),
          })
          .strict(),
      )
      .max(80),
  })
  .strict();
export const workspaceHenryRequest = z
  .object({
    requestKey: z.string().uuid(),
    conversationId: z.string().uuid(),
    instruction: z.string().trim().min(1).max(6000),
    objective: z.string().max(2000),
    screen: henryScreen,
  })
  .strict();
export const workspaceHenryTurn = z.object({
  id: z.string(),
  conversationId: z.string(),
  brandId: z.string(),
  section: henrySection,
  instruction: z.string(),
  result: workspaceHenryReply,
  screen: henryScreen,
  createdAt: z.string(),
});
export type HenryScreen = z.infer<typeof henryScreen>;
export type HenryReply = z.infer<typeof workspaceHenryReply>;
export type HenryTurn = z.infer<typeof workspaceHenryTurn>;
