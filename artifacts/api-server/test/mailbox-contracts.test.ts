import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createOAuthAttempt,
  validOAuthAttempt,
} from "../src/services/mailbox/oauth-state";
import {
  mailboxReadiness,
  outboundMail,
  matchesOutboundReply,
} from "../src/services/mailbox/contracts";

test("OAuth binds state to workspace, actor, provider, browser and expiry", () => {
  const binding = {
    workspaceId: "workspace_a",
    subject: "a",
    issuer: "issuer",
    clientId: "client",
    provider: "microsoft365" as const,
  };
  const a = createOAuthAttempt(binding, 1000);
  assert.equal(
    validOAuthAttempt(a.record, binding, a.state, a.browserSecret, 1001),
    true,
  );
  for (const key of ["workspaceId", "subject", "issuer", "clientId"] as const)
    assert.equal(
      validOAuthAttempt(
        a.record,
        { ...binding, [key]: "other" },
        a.state,
        a.browserSecret,
        1001,
      ),
      false,
    );
  assert.equal(
    validOAuthAttempt(
      a.record,
      { ...binding, provider: "google_workspace" },
      a.state,
      a.browserSecret,
      1001,
    ),
    false,
  );
  assert.equal(
    validOAuthAttempt(
      a.record,
      binding,
      a.state,
      createOAuthAttempt(binding).browserSecret,
      1001,
    ),
    false,
  );
  assert.equal(
    validOAuthAttempt(a.record, binding, a.state, a.browserSecret, 601000),
    false,
  );
  assert.equal(a.challenge.length, 43);
  assert.notEqual(a.record.stateHash, a.state);
});
test("connection readiness never grants campaign authority", () => {
  assert.equal(
    mailboxReadiness({
      connection: "connected",
      sendingVerified: true,
      repliesVerified: true,
    }).campaignExecutionAuthorised,
    false,
  );
  assert.equal(
    mailboxReadiness({
      connection: "connected",
      sendingVerified: true,
      repliesVerified: false,
    }).ready,
    false,
  );
  assert.equal(
    mailboxReadiness({
      connection: "disconnected",
      sendingVerified: true,
      repliesVerified: true,
    }).ready,
    false,
  );
});
test("outbound mail rejects forged sender and header injection", () => {
  const mail = {
    operationId: "51a222ab-7c88-42b1-ab73-cbf789c45abe",
    to: "test@example.com",
    subject: "Test",
    text: "test",
    html: "<p>test</p>",
  };
  assert.equal(outboundMail.safeParse(mail).success, true);
  assert.equal(
    outboundMail.safeParse({ ...mail, from: "other@example.com" }).success,
    false,
  );
  assert.equal(
    outboundMail.safeParse({
      ...mail,
      subject: "Test\r\nBcc: other@example.com",
    }).success,
    false,
  );
});
test("reply association requires an exact outbound message reference", () => {
  const reply = {
    providerId: "reply",
    conversationId: "thread",
    internetMessageId: "<reply@example.com>",
    references: ["<sent@example.com>"],
    from: "test@example.com",
    to: ["sender@example.com"],
    subject: "Re: Test",
    text: "Reply",
    occurredAt: new Date().toISOString(),
  };
  assert.equal(matchesOutboundReply(reply, "<sent@example.com>"), true);
  assert.equal(matchesOutboundReply(reply, "<different@example.com>"), false);
  assert.equal(
    matchesOutboundReply({ ...reply, references: [] }, "<sent@example.com>"),
    false,
  );
});
