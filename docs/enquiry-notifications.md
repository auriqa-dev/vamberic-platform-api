# Product enquiry email notifications

An accepted enquiry can send an internal operational email to the configured Product operators. This is reusable across Products and has no HVM-specific logic. It is not a marketing campaign or a confirmation email to the submitter; it does not depend on marketing opt-in and does not change consent records.

## Architecture and timing

`submitEnquiry` commits the existing Person / Organisation / Opportunity / Event transaction, then passes an explicit `enquiry_submitted` notification context to `NotificationService`. The context is built from the accepted submission and Product inside the transaction; it contains only fields needed by the renderer plus Product/Event IDs. It is returned from the successful transaction attempt, never dispatched inside the transaction callback or duplicate-key retry loop. Existing identity fields remain untouched; the notification names identify the current submission.

`NotificationService` resolves recipients through `NotificationRecipientResolver`, renders the email, and calls `EmailProvider.sendEmail({ to, from, subject, text, html? }, signal)`. `EnvironmentNotificationRecipients` is the initial resolver. `SesEmailProvider` uses AWS SDK v3 `@aws-sdk/client-ses` and structured UTF-8 `SendEmailCommand` content. Its SDK client uses `AWS_REGION` and the normal AWS credential provider chain, including the ECS **task role**, with no embedded credentials. No AWS client is constructed while notifications are disabled.

The public route contains no renderer or provider logic. `createApp` accepts injected providers, resolvers and a logger for tests; tests use no live AWS or MongoDB. The SDK is bundled into the existing API output because the runtime Docker image copies `dist` only. No Dockerfile or infrastructure changes are needed for that packaging correction.

## Configuration

| Server environment variable                    | Default                             | Meaning                                                                                                         |
| ---------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `NOTIFICATION_EMAIL_ENABLED`                   | `false`                             | Explicit `true` or `false`; mail sending is opt-in in every environment                                         |
| `NOTIFICATION_EMAIL_FROM`                      | Unset                               | Bare email address, required and validated when enabled; unused/invalid sender values are ignored when disabled |
| `PRODUCT_ENQUIRY_NOTIFICATION_RECIPIENTS_JSON` | `{}`                                | JSON object mapping valid `product_…` application IDs to 1–50 recipient email addresses per Product             |
| `AWS_REGION`                                   | Existing required app configuration | Same region used by the SES client; this remains required by Cognito even when notifications are disabled       |

Malformed recipient JSON, invalid Product IDs, invalid addresses and empty/oversized recipient arrays fail at startup with a fixed error that contains no supplied addresses or raw JSON. A missing Product key means no recipients, not an error. Email addresses are trimmed; exact duplicate recipients are removed before sending. All configured recipients are in the same email's To field and can see one another's addresses. There is no caller-supplied recipient override.

Example HVM configuration only (replace placeholder sender/recipients with approved real addresses):

```dotenv
NOTIFICATION_EMAIL_ENABLED=true
NOTIFICATION_EMAIL_FROM=notifications@example.com
PRODUCT_ENQUIRY_NOTIFICATION_RECIPIENTS_JSON={"product_01m2wffbf3p9p19d3nd1s2fp3x":["operator@example.com","backup@example.com"]}
```

For multiple Products, add independent keys to the JSON object:

```json
{
  "product_01m2wffbf3p9p19d3nd1s2fp3x": ["operator@example.com"],
  "product_00000000000000000000000001": ["another-operator@example.com"]
}
```

The second ID is illustrative and must be replaced with a real Product ID. Startup checks identifier syntax; it does not connect to MongoDB to verify Product existence. Disabled notifications need no sender or AWS email configuration. Enabling them with a missing or invalid sender fails clearly at startup. A valid local sender string does **not** establish that SES has verified it; that is an infrastructure prerequisite checked separately, not by making network calls at startup.

## Content and privacy

Subject: `New enquiry — {Product name} — {Company}`, bounded to 200 characters.

Plain text includes Product, submitted name, company, work email, role, canonical website domain, service interest, message, source/medium/campaign attribution, Opportunity ID and server receipt timestamp in UTC. Missing optional fields say “Not supplied.” Scalar fields have newlines/control characters removed; message line breaks are preserved and control/bidirectional override characters removed. No HTML is generated. Submitted markup is inert plain text.

No raw JSON/document, Mongo `_id`, internal DB metadata, request headers, authentication tokens or IP address is copied into the email. The explicit context projection is the boundary; user-written message content itself is still included. Event/Product IDs are used for safe log correlation. SES failures add `providerErrorCode` and, when validated, HTTP status, request ID and AccessDenied-specific fields to the structured failure log (see the diagnostic rules below). Only an explicitly allowlisted AWS/SES/SDK error name (or code fallback) is retained; unrecognised identifiers become `UnknownProviderError`. Arbitrary identifier text is never logged, even if it contains only letters. Non-provider failures and deadline-only timeouts do not add a provider code. Logs do not contain recipient/sender addresses, names, subjects, bodies, credentials, raw provider errors, stacks or SDK error causes. AWS request logging is not enabled.

## Delivery and failure semantics

- CRM persistence commits first. A failed or invalid enquiry never sends email.
- One send is attempted for the successful transaction attempt. The SDK uses `maxAttempts: 1`; there is no automatic delivery retry or queue.
- The service awaits best-effort resolution/send for at most five seconds before the API returns. Timeout requests cancellation. This can add up to five seconds to response latency after commit.
- Success logs `status=sent` with Product ID, Event ID and notification type. This means SES accepted the email, **not** that it reached an inbox.
- Disabled notifications and Products without recipients log a safe warning with `reason=disabled` or `no_recipients` and still accept the enquiry.
- Resolution/rendering/provider failures and timeouts log `delivery_failed` or `timeout`. Even a replacement dispatcher's unexpected exception cannot rerun or roll back the transaction.
- Every accepted enquiry keeps the same HTTP **201** body: `{ "status": "received", "enquiryId": "…" }`. Delivery results are never exposed publicly.
- No extra CRM Event, delivery collection, schema migration or index is added.

This is **best-effort, non-durable** delivery. A process exit after commit and before send can lose the email. A timeout can be ambiguous if SES already accepted it; cancellation does not retract mail. A repeated public submission is a separate accepted enquiry and can send a separate email. Do not automatically resubmit enquiries to retry email delivery. The CRM remains the authoritative record.

## AWS prerequisites — separate infrastructure task

Before enabling notifications:

1. Choose the real sender and operator recipients. Verify the sender email address or its domain in SES in the configured region. Domain verification/DKIM requires the relevant DNS records. Verification is regional. See [SES identities](https://docs.aws.amazon.com/ses/latest/dg/verify-addresses-and-domains.html) and [SES regions](https://docs.aws.amazon.com/ses/latest/dg/regions.html).
2. Check the account's SES sandbox status in that region. In the sandbox, recipients must also be verified (or SES simulator addresses). Production access is required to send to arbitrary unverified recipients. A verified sender remains required after sandbox removal. See [SES production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
3. Grant the API's ECS **task role** `ses:SendEmail`, scoped to the chosen verified identity and appropriate sender restriction. Use normal runtime credentials, not AWS keys in app configuration. See [SES IAM access](https://docs.aws.amazon.com/ses/latest/dg/control-user-access.html).
4. Ensure HTTPS connectivity to the regional SES API and access to the task-role credential endpoint. Configure the three new application variables through the normal ECS/CDK configuration workflow in a separately authorized infrastructure change.
5. Check SES sending quotas, account sending status, suppression and bounce/complaint handling as part of the operational rollout. Perform an explicitly authorized send check after setup; no real email was sent during implementation.

Actual SES verification, sandbox status and task-role permission were not inspected. No AWS infrastructure, HVM website or live database was modified. No deployment, commit or push was performed.

## Future extensions

Replace `NotificationRecipientResolver` with a Vapp Product Settings implementation without changing enquiry persistence. Additional notification types can add renderers and recipient rules behind the service. For reliable retries, introduce a separately designed durable outbox/dispatcher with stable Event-based deduplication and persisted delivery status; address the commit-to-send gap explicitly. The current result union (`sent`, `skipped`, `failed`) and explicit event context provide seams without adding another CRM Event or a notification database model now.

## Validation

Validated with Node **24.21.0** and pnpm **10.26.1**. Tests use fake email transports, local signed authentication tokens and an in-memory Mongo substitute. They verify commit ordering (including commit failure), retries without duplicate sends, configuration, multiple/missing recipients, safe content/logging, provider and resolver failures/timeouts, retained CRM records and unchanged private authentication. No live SES delivery verification is claimed.

| Check                                                  | Result                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `PORT=3000 BASE_PATH=/ pnpm run build`                 | Pass; existing Vapp chunk-size warning above 500 kB                                                        |
| `pnpm --filter @workspace/api-server run lint`         | Pass                                                                                                       |
| `pnpm run typecheck`                                   | Pass                                                                                                       |
| `pnpm --filter @workspace/api-server run test`         | **119/119 pass**: 97 existing tests and 22 new notification tests                                          |
| `pnpm --filter @workspace/api-server run format:check` | Pass                                                                                                       |
| `git diff --check`                                     | Pass                                                                                                       |
| Isolated compiled-runtime startup and `/health`        | Pass with notifications disabled and enabled, without source or `node_modules`; no SES send or Mongo query |

Local HTTP tests and the compiled-runtime check needed loopback-listener sandbox permission. No Docker image was built and no SES send was attempted. OpenAPI and generated clients are unchanged because the public API contract is unchanged.

## Changed files / final git status

New modules contain configuration/recipient resolution, the email adapter, the renderer and the notification service. Existing enquiry orchestration now dispatches only after commit. App composition injects the service, configuration adds the opt-in variables, and build/dependencies include SES in the dist-only runtime. Tests and documentation complete the change. There are no changes to persistence models, infrastructure or the HVM website.

All changes are unstaged. Full status:

```text
 M artifacts/api-server/.env.example
 M artifacts/api-server/README.md
 M artifacts/api-server/build.mjs
 M artifacts/api-server/package.json
 M artifacts/api-server/src/app.ts
 M artifacts/api-server/src/config.ts
 M artifacts/api-server/src/routes/public-enquiries.ts
 M artifacts/api-server/src/services/enquiries.ts
 M docs/public-enquiries.md
 M pnpm-lock.yaml
?? artifacts/api-server/src/notifications/config.ts
?? artifacts/api-server/src/notifications/email-provider.ts
?? artifacts/api-server/src/notifications/enquiry-email.ts
?? artifacts/api-server/src/notifications/service.ts
?? artifacts/api-server/test/notifications.test.ts
?? docs/enquiry-notifications.md
```

## Application request inspection: AccessDenied

The inspected provider uses **AWS SDK v3 `@aws-sdk/client-ses`**, `SESClient` and `SendEmailCommand`. This is the classic SES API (`2010-12-01`), not SES API v2 / `SESv2Client`. The SDK version and the service API version are separate concepts. The complete application command input is:

```ts
{
  Source: message.from,
  Destination: { ToAddresses: [...message.to] },
  Message: {
    Subject: { Data: message.subject, Charset: "UTF-8" },
    Body: {
      Text: { Data: message.text, Charset: "UTF-8" },
      // Only included when the caller provides nonempty HTML:
      ...(message.html
        ? { Html: { Data: message.html, Charset: "UTF-8" } }
        : {}),
    },
  },
}
```

The enquiry renderer supplies no HTML. `message.from` comes from validated `NOTIFICATION_EMAIL_FROM`; recipients come from the Product recipient resolver. The client is constructed with `{ region: config.notifications.region, maxAttempts: 1 }`, where the region comes from `AWS_REGION`. Credentials use the standard SDK chain; application code does not supply credentials, select a role ARN, or override an endpoint. `{ abortSignal: signal }` is passed as a client send option, not an SES request property.

None of `FromEmailAddressIdentityArn`, `SourceArn`, `ReturnPathArn`, `FeedbackForwardingEmailAddressIdentityArn`, configuration-set, tenant or other delegated-sending fields is set. There is also no explicit ReturnPath, ReplyToAddresses or Tags. AWS documents `SourceArn`/`ReturnPathArn` as sending-authorization fields in the [classic API](https://docs.aws.amazon.com/ses/latest/APIReference/API_SendEmail.html); the comparable `FromEmailAddressIdentityArn` field belongs to the [v2 request](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html). No request-field removal, API-version migration or identity authorization policy is justified by this inspection.

Two regression tests verify the exact command keys (including optional HTML) and the installed SDK's serialized HTTP request using fake credentials and an in-memory request handler. With region `eu-west-2`, the latter selects `email.eu-west-2.amazonaws.com`, POST `/`, and adds only the Query protocol's `Action=SendEmail` and `Version=2010-12-01` to the form-encoded email fields. Signing/transport headers are SDK-managed; no live request or production payload logging is introduced.

**Root cause is not proven.** Unnecessary delegation fields are ruled out for this repository implementation and its tested serializer, not for an independently inspected deployed image. No live task revision, effective credential identity, runtime sender/recipient values or failed AWS request was inspected. The next evidence to compare with the successful direct send is the deployed image revision, effective AWS principal, region and configured sender/recipient match. A successful direct send and IAM simulation alone do not establish that the application made an equivalent request with the same credentials.

Validation: **125/125 API tests pass**, including the existing privacy-safe failure logging, post-commit behavior, timeouts and 201 acceptance tests. Build, lint, typecheck, format check and `git diff --check` pass; the existing Vapp bundle-size warning remains. Only notification tests and this documentation changed. No IAM, infrastructure, production request logic or logging changes were made; nothing was deployed, committed or pushed.

## Safe SES failure metadata and AccessDenied diagnostics

The log retains `providerErrorCode` using the existing explicit error-name/code allowlist. Optional fields are extracted at the SES adapter boundary and carried in an immutable diagnostic object on the generic `EmailProviderError`. The original AWS error, its message, cause, metadata object, headers and stack are never attached to that wrapper or logged.

| Field                | Acceptance rule                                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `providerHttpStatus` | `$metadata.httpStatusCode` must be an integer number from 100 through 599; no coercion                                                                                                                      |
| `providerRequestId`  | `$metadata.requestId` must be exactly 36 characters in UUID-style hexadecimal `8-4-4-4-12` form; arbitrary identifiers, tokens, whitespace and addresses are discarded                                      |
| `deniedAction`       | Exactly `ses:SendEmail`                                                                                                                                                                                     |
| `deniedResource`     | A complete `arn:aws:ses:<region>:<12-digit-account>:identity/<DNS-domain>` ARN, at most 320 characters; no email identities, encoded addresses, arbitrary resource names or other resource types            |
| `deniedPrincipal`    | A complete `arn:aws:sts::<12-digit-account>:assumed-role/<role>/<32-lowercase-hex-task-id>` ARN; role is 1–64 ASCII letters/digits/underscores/hyphens; no arbitrary human/session names or email addresses |

Denial fields are considered only for `AccessDenied` and `AccessDeniedException`. The parser recognises an anchored, single-line AWS sentence of the form `User: <principal> is not authorized to perform: <action> on resource: <resource>`, optionally followed by ` because ...`. It accepts the conventional colon-less form and matching single/double/backtick quotes around tokens. Messages longer than 4096 characters and unrecognised formats are ignored. It does not search arbitrary prose for ARNs or actions. Only individually validated captures survive; the explanatory suffix never does. Account IDs and role names are not hard-coded to one deployment.

An identity such as `identity/notifications@vamberic.com` is deliberately **omitted**, not logged or partially reconstructed: the no-address privacy requirement takes precedence. A principal with an email or personal name as its session is also omitted. The action and other independently valid fields can still be retained. Metadata may be logged on any SES failure, but denial parsing does not run for other error codes. Deadline-only failures have no fabricated AWS metadata.

The user reports the running image, task role, absence of identity policies/boundary, successful direct sending and IAM simulation have been verified. These application diagnostics do not alter those controls or claim to identify the live cause before new evidence arrives. No infrastructure or IAM was changed, and no live SES send was performed.

Validation for this change: **143/143 API tests pass**, including 18 added diagnostic tests and the earlier command/serialization regression tests. Tests verify exact safe log objects, retained 201/CRM persistence, metadata validation, recognised/quoted denial messages, email identities, personal sessions, unexpected actions/resources, arbitrary/multiline/oversized messages, and absence of raw error content. Build, lint, typecheck, format check and `git diff --check` results are checked before handoff. Existing post-commit best-effort delivery and timeout behavior are unchanged.
