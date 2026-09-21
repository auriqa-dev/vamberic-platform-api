import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { SendEmailCommand } from "@aws-sdk/client-ses";
import { createApp } from "../src/app";
import { parseConfig } from "../src/config";
import { ProductSchema } from "../src/domain";
import { EnvironmentNotificationRecipients } from "../src/notifications/config";
import {
  SesEmailProvider,
  EmailProviderError,
  type EmailMessage,
} from "../src/notifications/email-provider";
import {
  renderEnquiryEmail,
  type EnquirySubmittedNotification,
} from "../src/notifications/enquiry-email";
import {
  createNotificationService,
  type NotificationDependencies,
} from "../src/notifications/service";
import { submitEnquiry } from "../src/services/enquiries";
import { EnquiryMemoryDb } from "./helpers/enquiry-db";
import { authEnvironment, createTestAuth } from "./helpers/auth";

const productId = "product_00000000000000000000000001";
const otherProductId = "product_00000000000000000000000002";
const input = {
  firstName: "Mary Ann",
  lastName: "van Buren",
  workEmail: "mary@example.com",
  company: "Example Ltd",
  website: "https://www.example.com/about",
  jobTitle: "Director",
  serviceInterest: "Review",
  message: "Please discuss our requirements.\nThank you.",
  source: "search",
  medium: "organic",
  campaign: "launch",
};
const environment = {
  ...authEnvironment,
  DEPLOYMENT_ENV: "test",
  MONGODB_URI: "mongodb://unused.invalid",
  NOTIFICATION_EMAIL_ENABLED: "true",
  NOTIFICATION_EMAIL_FROM: "notices@example.com",
  PRODUCT_ENQUIRY_NOTIFICATION_RECIPIENTS_JSON: JSON.stringify({
    [productId]: ["operator@example.com", "second@example.com"],
    [otherProductId]: ["other@example.com"],
  }),
};
const context: EnquirySubmittedNotification = {
  type: "enquiry_submitted",
  productId,
  productName: "Agency",
  personName: "Mary Ann van Buren",
  ...input,
  website: "example.com",
  opportunityId: "opportunity_00000000000000000000000001",
  eventId: "event_00000000000000000000000001",
  occurredAt: new Date("2026-09-21T12:00:00Z"),
};
function records() {
  const db = new EnquiryMemoryDb();
  db.rows("products").push({
    ...ProductSchema.parse({
      id: productId,
      name: "Agency",
      slug: "agency",
      productType: "agency",
      lifecycleStatus: "live",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    _id: "mongo-internal-secret",
    legacyProductData: { secret: "internal-database-detail" },
  });
  return db;
}
function captureLogs() {
  const entries: { fields: Record<string, string>; message: string }[] = [];
  const log = (fields: Record<string, string>, message: string) => {
    entries.push({ fields, message });
  };
  return { entries, logger: { info: log, warn: log } };
}
async function fixture(
  t: TestContext,
  overrides: Record<string, string | undefined> = {},
  dependencies: NotificationDependencies = {},
) {
  const db = records();
  let committed = false;
  const transaction = db.mongo.withTransaction!;
  db.mongo.withTransaction = async (work) => {
    const result = await transaction(work);
    committed = true;
    return result;
  };
  const messages: EmailMessage[] = [];
  const logs = captureLogs();
  const auth = await createTestAuth();
  const app = createApp(
    parseConfig({ ...environment, ...overrides }),
    db.mongo,
    {
      jwtKeyResolver: auth.keyResolver,
      notifications: {
        logger: logs.logger,
        provider: {
          async sendEmail(message) {
            assert.equal(
              committed,
              true,
              "provider must run only after transaction resolves",
            );
            for (const collection of [
              "people",
              "organisations",
              "opportunities",
              "events",
            ])
              assert.equal(db.rows(collection).length, 1);
            messages.push(message);
          },
        },
        ...dependencies,
      },
    },
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (body: unknown = input) => {
    const response = await fetch(
      `${url}/api/v1/public/products/${productId}/enquiries`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token-must-not-leak",
          "x-private-header": "header-must-not-leak",
          "x-forwarded-for": "192.0.2.99",
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  return { db, request, messages, logs, url };
}

test("accepted enquiry sends to configured multiple Product recipients after commit with minimal content", async (t) => {
  const { db, request, messages, logs } = await fixture(t);
  const response = await request();
  assert.equal(response.status, 201);
  assert.deepEqual(response.body, {
    status: "received",
    enquiryId: db.rows("events")[0].id,
  });
  assert.equal(messages.length, 1);
  const email = messages[0];
  assert.deepEqual(email.to, ["operator@example.com", "second@example.com"]);
  assert.equal(email.from, "notices@example.com");
  assert.equal(email.subject, "New enquiry — Agency — Example Ltd");
  for (const text of [
    "New enquiry received",
    "Product: Agency",
    "Name: Mary Ann van Buren",
    "Company: Example Ltd",
    "Work email: mary@example.com",
    "Role: Director",
    "Website: example.com",
    "Service interest: Review",
    "Please discuss our requirements.",
    "Source: search",
    "Medium: organic",
    "Campaign: launch",
    `Opportunity ID: ${db.rows("opportunities")[0].id}`,
    db.rows("events")[0].occurredAt.toISOString(),
  ])
    assert.ok(email.text.includes(text), text);
  const serialized = JSON.stringify(email);
  for (const secret of [
    "mongo-internal-secret",
    "internal-database-detail",
    "token-must-not-leak",
    "header-must-not-leak",
    "192.0.2.99",
    "_id",
    "other@example.com",
  ])
    assert.equal(serialized.includes(secret), false, secret);
  assert.equal(email.html, undefined);
  assert.deepEqual(logs.entries[0].fields, {
    productId,
    notificationType: "enquiry_submitted",
    eventId: response.body.enquiryId,
    status: "sent",
  });
  const logText = JSON.stringify(logs.entries);
  for (const value of [
    input.workEmail,
    input.message,
    input.company,
    "operator@example.com",
  ])
    assert.equal(logText.includes(value), false);
  assert.equal(db.rows("events").length, 1, "no delivery CRM Event is created");
});

test("Product with no recipients still persists and returns 201 with a safe skipped warning", async (t) => {
  const { db, request, messages, logs } = await fixture(t, {
    PRODUCT_ENQUIRY_NOTIFICATION_RECIPIENTS_JSON: JSON.stringify({
      [otherProductId]: ["other@example.com"],
    }),
  });
  assert.equal((await request()).status, 201);
  assert.equal(messages.length, 0);
  assert.equal(db.rows("events").length, 1);
  assert.equal(logs.entries[0].fields.reason, "no_recipients");
});

test("provider failure preserves Person, Organisation, Opportunity and Event and returns unchanged 201", async (t) => {
  const { db, request, logs } = await fixture(
    t,
    {},
    {
      provider: {
        async sendEmail() {
          throw new Error("SES rejected private@example.com secret body token");
        },
      },
    },
  );
  const result = await request();
  assert.equal(result.status, 201);
  assert.deepEqual(result.body, {
    status: "received",
    enquiryId: db.rows("events")[0].id,
  });
  for (const collection of [
    "people",
    "organisations",
    "opportunities",
    "events",
  ])
    assert.equal(db.rows(collection).length, 1, collection);
  assert.equal(db.attempts, 1);
  assert.equal(logs.entries[0].fields.reason, "delivery_failed");
  assert.equal(
    JSON.stringify(logs.entries).includes("private@example.com"),
    false,
  );
  assert.equal(JSON.stringify(result.body).includes("SES"), false);
});

test("disabled notifications require no sender, never send, and leave private authentication unchanged", async (t) => {
  const { request, messages, logs, url } = await fixture(t, {
    NOTIFICATION_EMAIL_ENABLED: "false",
    NOTIFICATION_EMAIL_FROM: undefined,
  });
  assert.equal((await request()).status, 201);
  assert.equal(messages.length, 0);
  assert.equal(logs.entries[0].fields.reason, "disabled");
  for (const route of [
    "products",
    "people",
    "organisations",
    "opportunities",
  ]) {
    const response = await fetch(`${url}/api/v1/${route}`);
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
});

test("failed or invalid enquiries never attempt email; transaction retries send only once", async (t) => {
  const { db, request, messages } = await fixture(t);
  assert.equal((await request({ ...input, lastName: "" })).status, 400);
  assert.equal(messages.length, 0);
  db.failCollection = "events";
  assert.equal((await request()).status, 503);
  assert.equal(messages.length, 0);
  assert.equal(db.rows("people").length, 0);
  db.failCollection = undefined;
  db.duplicateOnce = true;
  assert.equal((await request()).status, 201);
  assert.equal(messages.length, 1);
  assert.equal(db.rows("events").length, 1);
});

test("commit failure does not send even when the transaction callback completed", async () => {
  const db = records();
  const original = db.mongo.withTransaction!;
  let sends = 0;
  db.mongo.withTransaction = (work) =>
    original(async (database, session) => {
      await work(database, session);
      throw new Error("commit failed");
    });
  await assert.rejects(
    submitEnquiry(db.mongo, productId, input, {
      async notify() {
        sends++;
        return { status: "sent" };
      },
    }),
  );
  assert.equal(sends, 0);
  assert.equal(db.rows("events").length, 0);
});

test("a replacement dispatcher failure cannot retry or roll back committed CRM persistence", async () => {
  const db = records();
  const id = await submitEnquiry(db.mongo, productId, input, {
    async notify() {
      throw Object.assign(new Error("private provider failure"), {
        code: 11000,
      });
    },
  });
  assert.equal(id, db.rows("events")[0].id);
  assert.equal(db.attempts, 1);
});

test("recipient resolver isolates Products and supports replacement with future Product Settings", async () => {
  const mapping = new EnvironmentNotificationRecipients(
    parseConfig(environment).notifications.recipients,
  );
  assert.deepEqual(await mapping.resolve(productId), [
    "operator@example.com",
    "second@example.com",
  ]);
  assert.deepEqual(await mapping.resolve(otherProductId), [
    "other@example.com",
  ]);
  assert.deepEqual(
    await mapping.resolve("product_00000000000000000000000003"),
    [],
  );
  const messages: EmailMessage[] = [];
  const service = createNotificationService(
    parseConfig(environment).notifications,
    {
      logger: captureLogs().logger,
      recipients: {
        async resolve(id, type) {
          assert.equal(id, productId);
          assert.equal(type, "enquiry_submitted");
          return ["settings@example.com"];
        },
      },
      provider: {
        async sendEmail(message) {
          messages.push(message);
        },
      },
    },
  );
  assert.deepEqual(await service.notify(context), { status: "sent" });
  assert.deepEqual(messages[0].to, ["settings@example.com"]);
});

for (const invalid of [
  "not-json",
  "null",
  "[]",
  JSON.stringify({ product_abc: ["operator@example.com"] }),
  JSON.stringify({ [productId]: [] }),
  JSON.stringify({ [productId]: ["not-email"] }),
  JSON.stringify({ [productId]: "operator@example.com" }),
  JSON.stringify({ [productId]: Array(51).fill("operator@example.com") }),
  JSON.stringify({ "secret@example.com": ["private@example.com"] }),
]) {
  test(`recipient configuration rejects invalid mapping case ${["not-json", "null", "[]"].includes(invalid) ? invalid : invalid.length}`, () => {
    assert.throws(
      () =>
        parseConfig({
          ...environment,
          PRODUCT_ENQUIRY_NOTIFICATION_RECIPIENTS_JSON: invalid,
        }),
      (error) =>
        error instanceof Error &&
        error.message.includes(
          "PRODUCT_ENQUIRY_NOTIFICATION_RECIPIENTS_JSON",
        ) &&
        !error.message.includes("secret@example.com") &&
        !error.message.includes("private@example.com"),
    );
  });
}

test("sender/enable configuration is validated at startup and production can opt out", () => {
  for (const sender of [
    "invalid",
    "",
    "operator@example.com\r\nBcc: secret@example.com",
  ])
    assert.throws(
      () => parseConfig({ ...environment, NOTIFICATION_EMAIL_FROM: sender }),
      /NOTIFICATION_EMAIL_FROM/,
    );
  assert.throws(
    () => parseConfig({ ...environment, NOTIFICATION_EMAIL_FROM: undefined }),
    /NOTIFICATION_EMAIL_FROM must be a valid email address/,
  );
  assert.throws(
    () => parseConfig({ ...environment, NOTIFICATION_EMAIL_ENABLED: "yes" }),
    /NOTIFICATION_EMAIL_ENABLED/,
  );
  const config = parseConfig({
    ...environment,
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "prod",
    NOTIFICATION_EMAIL_ENABLED: undefined,
    NOTIFICATION_EMAIL_FROM: undefined,
    PRODUCT_ENQUIRY_NOTIFICATION_RECIPIENTS_JSON: undefined,
  });
  assert.equal(
    parseConfig({
      ...environment,
      NOTIFICATION_EMAIL_ENABLED: "false",
      NOTIFICATION_EMAIL_FROM: "unused-invalid-sender",
    }).notifications.from,
    undefined,
  );
  assert.equal(config.notifications.enabled, false);
  assert.deepEqual(config.notifications.recipients, {});
});

test("renderer sanitizes scalar fields and message controls while sending only plain text", () => {
  const result = renderEnquiryEmail({
    ...context,
    productName: "Agency\r\nBcc: attacker",
    company: "Example\u0000 Ltd",
    message: "First\r\nSecond\u0000\u202e<script>alert(1)</script>",
  });
  for (const character of ["\r", "\n", "\u0000"])
    assert.equal(result.subject.includes(character), false);
  assert.equal(result.text.includes("\u0000"), false);
  assert.equal(result.text.includes("\u202e"), false);
  assert.ok(result.text.includes("  First\n  Second<script>alert(1)</script>"));
  assert.equal("html" in result, false);
});

test("SES adapter builds UTF-8 structured mail, passes cancellation, and strips provider errors", async () => {
  let calls = 0;
  const signal = new AbortController().signal;
  const provider = new SesEmailProvider("eu-west-2", {
    async send(command, options) {
      calls++;
      assert.ok(command instanceof SendEmailCommand);
      assert.equal(options.abortSignal, signal);
      assert.deepEqual(command.input, {
        Source: "notices@example.com",
        Destination: { ToAddresses: ["operator@example.com"] },
        Message: {
          Subject: { Data: "Subject", Charset: "UTF-8" },
          Body: { Text: { Data: "Body", Charset: "UTF-8" } },
        },
      });
      return { $metadata: {} };
    },
  });
  await provider.sendEmail(
    {
      to: ["operator@example.com"],
      from: "notices@example.com",
      subject: "Subject",
      text: "Body",
    },
    signal,
  );
  assert.equal(calls, 1);
  const failing = new SesEmailProvider("eu-west-2", {
    async send() {
      throw new Error("private@example.com secret");
    },
  });
  await assert.rejects(
    failing.sendEmail({
      to: [],
      from: "sender@example.com",
      subject: "x",
      text: "y",
    }),
    (error) =>
      error instanceof EmailProviderError &&
      error.message === "Email provider unavailable" &&
      error.cause === undefined,
  );
});

test("notification deadline aborts a stalled provider and still returns 201", async (t) => {
  let aborted = false;
  const { request, db, logs } = await fixture(
    t,
    {},
    {
      timeoutMs: 10,
      provider: {
        async sendEmail(_message, signal) {
          return new Promise<void>((_resolve, reject) =>
            signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(new Error("aborted"));
              },
              { once: true },
            ),
          );
        },
      },
    },
  );
  assert.equal((await request()).status, 201);
  assert.equal(aborted, true);
  assert.equal(logs.entries[0].fields.reason, "timeout");
  assert.equal(db.rows("events").length, 1);
});

test("resolver failure and late resolution cannot reject the enquiry or send after the deadline", async () => {
  let sends = 0;
  let resolve!: (value: string[]) => void;
  const logs = captureLogs();
  const service = createNotificationService(
    parseConfig(environment).notifications,
    {
      logger: logs.logger,
      timeoutMs: 5,
      recipients: {
        resolve: () =>
          new Promise<string[]>((done) => {
            resolve = done;
          }),
      },
      provider: {
        async sendEmail() {
          sends++;
        },
      },
    },
  );
  assert.deepEqual(await service.notify(context), {
    status: "failed",
    reason: "timeout",
  });
  resolve(["operator@example.com"]);
  await new Promise((done) => setImmediate(done));
  assert.equal(sends, 0);
  const failing = createNotificationService(
    parseConfig(environment).notifications,
    {
      logger: logs.logger,
      recipients: {
        async resolve() {
          throw new Error("secret");
        },
      },
      provider: {
        async sendEmail() {
          sends++;
        },
      },
    },
  );
  assert.deepEqual(await failing.notify(context), {
    status: "failed",
    reason: "delivery_failed",
  });
  assert.equal(sends, 0);
});
