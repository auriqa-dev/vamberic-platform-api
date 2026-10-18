# HVM API automation — review preparation, 18 October 2026

Local preparation only. Nothing committed, pushed, deployed or enabled. No IAM, database, GitHub configuration or application records changed.

## Verified predecessor

Read-only inspection found `VambericDevApi` in `UPDATE_COMPLETE`, API task revision 155 and worker revision 4. The API image is:

`755905325223.dkr.ecr.eu-west-2.amazonaws.com/vamberic-dev-api@sha256:d705069081513c108280e1bb1fbc43fc54d136f4bebd1da83df3fce0dba815ec`

ECR associates it with `nba-contact-strategies-api-20261018`. Retained release evidence is in `../../release-reviews/nba-contact-strategies-20261018/`. This is artifact evidence, not proof of a clean Git commit. The stack's `ApiImageTag` value, `8c6417be4486019d01a8eaa58973e63738b66e4d`, is unused by its literal image and must not be reported as the deployed revision.

## Source reconciliation

Comparison against the retained `api-source` snapshot covered API source/build inputs, protocol/Zod libraries and root package/TypeScript inputs: 584 matching files, 11 changed application source files, five new files and one changed generated TypeScript build-info file. No snapshot-only files were found in that scope. This is not a container filesystem comparison or proof of reproducible image construction.

Changed files beneath `artifacts/api-server/src`: `app.ts`, `domain/schemas.ts`, `routes/campaigns.ts`, `routes/hvm.ts`, `services/campaigns/service.ts`, `services/communications/service.ts`, `services/content-strategy/workspace-henry.ts`, `services/crm-foundation.ts`, `services/email-templates/render.ts`, `services/performance/service.ts`, `services/website-tracking/service.ts`.

New files: `routes/business-outcomes.ts`, `services/business-outcomes/model.ts`, `services/business-outcomes/service.ts`, `services/campaigns/journey.ts`, `services/campaigns/tracking.ts`.

These ongoing changes are preserved, not implicitly approved for deployment. Do not reset, stash, bulk commit or merge the release branch into main as an automation shortcut. Before enabling automation, review the intended complete source baseline, database requirements and worker/frontend compatibility. A release tag cannot reconstruct that baseline. No application source was edited by this preparation.

The comparison is a point-in-time checkpoint. During preparation, independent changes were observed in API `services/agent-control-plane.ts`, `services/agent-execution-readiness.ts`, `services/nba/native.ts`, `test/nba-persistence.test.ts`, and HVM frontend `src/data/measurement.ts` and `test/measurement.test.tsx`. They were left untouched and excluded from the automation patches. Refresh the source comparison before choosing the release baseline.

## Prepared changes

- `scripts/deploy/release.mjs` resolves the full Git commit's immutable ECR tag to a SHA-256 digest and updates only `ApiImageDigest` using the deployed template. The task definition and every running task must use that exact repository/digest. Existing migration, ownership, stack-state, change-scope, rollback and readiness checks remain.
- `scripts/deploy/reconcile-image.mjs` is an offline transformer with no AWS calls. Given a retained template and exact predecessor image, it replaces only the image expression and parameter definition. It rejects changed predecessors, unexpected repositories, other legacy parameter consumers and invalid service/template structure. It writes a new mode-0600 file and refuses overwrite.
- Infrastructure's `lib/api-stack.ts` declares the matching dev digest parameter without a default. Production retains its existing tag path. The existing ECR pull grant is retained. Other pre-existing edits in this file remain intact and are not authorised for deployment.
- The workflow's API deployment job requires repository variable `HVM_API_AUTOMATION_ENABLED=true`. Do not set it yet. Validation can run while deployment is disabled; a skipped release is not reported as success. Vapp remains dependent on successful API deployment. Main-only checks and non-cancelling deployment concurrency remain.

This reuses existing GitHub/AWS machinery; no new service, dependency or IAM permission is needed for the preparation. Portfolio status tooling and affected-service optimisation remain later increments.

## Offline reconciliation result

The tool was exercised against a fresh live template snapshot. Only these JSON paths changed:

1. `/Parameters/ApiImageTag` removed.
2. `/Parameters/ApiImageDigest` added.
3. `/Resources/ApiTaskDefinition51EA709E/Properties/ContainerDefinitions/0/Image` changed to the existing repository plus digest parameter.

The supplied parameter resolves to the SAME running image. Every other template field is preserved. Private snapshots/candidates remain outside Git under `/tmp/hvm-automation-review-20261018/`. Refresh them before any eventual application; do not commit them or print their configuration contents.

```sh
node scripts/deploy/reconcile-image.mjs private-template.json <verified-current-image> private-candidate.json
```

This command is offline only. Its output contains `template` and `parameter`; it is a review bundle, not a directly deployable template file. No CloudFormation change set has been created. Do not bootstrap through a full CDK deployment: the working infrastructure tree includes other changes and may not reproduce all live runtime configuration.

## Approval and eventual rollout

1. Review the automation-only patch and intended complete source baseline. Select commits explicitly; no push to main until its deployment implications are approved.
2. Refresh account identity, template/stack state, task ownership, running digest and ECR availability. Stop and regenerate the review if another release changed the predecessor.
3. Under a separate bounded approval, prepare an image-contract-only change set for account `755905325223`, region `eu-west-2`, stack `VambericDevApi`. Preserve all other parameter values and supply the current digest. Reject worker, IAM, environment, secret, database, network or service-replacement changes.
4. Apply only after reviewing that change set. Even an equivalent image expression can register a task revision/restart tasks. Verify stability, unchanged image digest and health/readiness. Preserve the predecessor template, parameter values and image for recovery; keep ECS rollback enabled. Reuse established recovery without another backup rehearsal.
5. After reviewing source/compatibility and branch protections, separately authorise enabling the repository variable and the first routine release. Do not bypass preflight or broaden permissions to fix a failure.
6. Verify the requested full Git SHA maps to the running digest and test the relevant user journey. Pipeline success alone does not prove frontend/worker compatibility.

The first live approval must name refreshed artifacts, exact stack/change set, recovery files and acceptance steps. Bootstrap scope: one contract update and bounded ECS/HTTP checks; no image build/publish, new infrastructure, paid external integration or data writes. Existing AWS usage costs apply. Stop for additional scope/resources.

## Validation

Node 24 release tests: 19 passed, exercising CLI entrypoints with fake AWS executables, image-only updates, digest verification, reruns, rollback failures, drift, safe diagnostics and offline preservation. Infrastructure TypeScript check passed. Focused stack tests: 20 passed. No container rebuild or application/database test suite was needed for this deployment-only preparation. Live deployment acceptance remains pending approval.

The older deployment guide describes the legacy tag contract and historical rollout. Its historic image tags are not current release inputs.
