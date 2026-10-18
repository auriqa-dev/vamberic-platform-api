import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  personal,
  branded,
} from "../src/services/email-templates/render";
import type { EmailRecord } from "../src/services/email-content/model";
import type { BrandKit } from "../src/domain/brands";
const draft = {
  content: {
    subject: "Hello",
    body: "Hello\nPlease read this.",
    ctaText: "Please read this.",
  },
  ctaUrl: "https://example.com/page",
} as EmailRecord;
test("renders one CTA when the body already contains it, without changing the text", () => {
  const r = renderTemplate(draft);
  assert.equal((r.html.match(/href=/g) || []).length, 1);
  assert.equal((r.text.match(/Please read this\./g) || []).length, 1);
  assert.ok(r.text.includes(draft.ctaUrl));
});
test("reply CTA is not duplicated and no link is invented", () => {
  const r = renderTemplate({ ...draft, ctaUrl: "" });
  assert.equal((r.text.match(/Please read this\./g) || []).length, 1);
  assert.ok(!r.html.includes("href="));
});
test("untrusted copy is escaped and dangerous URLs rejected", () => {
  const r = renderTemplate({
    ...draft,
    content: { ...draft.content, body: "<script>alert(1)</script>" },
  });
  assert.ok(!r.html.includes("<script>"));
  assert.ok(r.html.includes("&lt;script&gt;"));
  assert.throws(() =>
    renderTemplate({ ...draft, ctaUrl: "javascript:alert(1)" }),
  );
  assert.throws(() =>
    renderTemplate({ ...draft, ctaUrl: "https://user:pass@example.com" }),
  );
});
test("brand roles and signature come from supplied kit, with safe email font fallbacks", () => {
  const kit = {
    colours: [{ role: "primary", hex: "#123456" }],
    typography: [{ role: "body", family: "Poppins" }],
    emailDefaults: {
      signature: "Alex\nExample",
      legalFooter: "Company footer",
    },
  } as BrandKit;
  const r = renderTemplate(draft, branded, kit);
  assert.ok(r.html.includes("#123456"));
  assert.ok(r.html.includes("Poppins"));
  assert.ok(r.text.includes("Alex\nExample"));
  assert.ok(r.text.includes("Company footer"));
  assert.ok(!renderTemplate(draft, personal).html.includes("#123456"));
});
test("a URL already present is linked once", () => {
  const r = renderTemplate({
    ...draft,
    content: { ...draft.content, body: "Visit https://example.com/page" },
  });
  assert.equal((r.html.match(/href=/g) || []).length, 1);
  assert.equal((r.text.match(/https:\/\/example.com\/page/g) || []).length, 1);
});

test("embedded logos use related MIME without exposing a remote asset URL", async () => {
  const { emailMime } = await import("../src/services/mailbox/google");
  const mime = emailMime(
    "owner@example.com",
    {
      operationId: "test",
      to: "reader@example.com",
      subject: "Example",
      text: "Hello",
      html: '<img src="cid:brand-logo" alt="Example">',
      inlineImages: [
        { cid: "brand-logo", base64: Buffer.from("image").toString("base64") },
      ],
    },
    "<test@example.com>",
    "<prior@example.com>",
  );
  assert.match(mime, /multipart\/related/);
  assert.match(mime, /multipart\/alternative/);
  assert.match(mime, /Content-ID: <brand-logo>/);
  assert.match(mime, /In-Reply-To: <prior@example.com>/);
});
