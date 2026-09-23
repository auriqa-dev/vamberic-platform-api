# Dev API and Vapp releases

## Rollout status

The replacement workflow is **Deploy dev API and Vapp** (`.github/workflows/deploy-dev.yml`). It replaces the two manual workflows **Build and push development image** and **Deploy Vapp frontend**.

The operator reports that the infrastructure prerequisites are deployed: `VambericDevApiDeploymentPermissions`, removal of `AmazonECS_FullAccess` from the API GitHub role, the `ApiImageTag` parameter bootstrapped to `5f15a3e` with ECS still using that image, and the Vapp invalidation permission update. Local infrastructure source inspection confirms the parameter and scoped release policy implementation. No live AWS verification or deployment was performed in this preparation task; the workflow checks live prerequisites before publishing an image.

The tracked Vapp lion asset is present and matches `HEAD`; its existing desktop/mobile sidebar use remains unchanged. The sections below describe the ownership contract and infrastructure requirements to retain, rather than outstanding bootstrap work. The API role's release policy is managed in `lib/api-deployment-permissions-stack.ts` in the infrastructure repository; its existing trust and ECR policy remain externally managed.

## Routine process

1. Make and review application changes locally.
2. Run `bash scripts/deploy/validate.sh` with Node 24, pnpm 10.26.1 and installed frozen-lockfile dependencies. Code generation must leave the generated trees clean.
3. Commit and push/merge to `main`.
4. GitHub validates, publishes the full 40-character commit SHA image, releases the API, verifies ECS and readiness, then builds and releases Vapp.

Jobs use `ubuntu-latest`, Node 24 and pnpm 10.26.1. Validation includes codegen consistency (including untracked generated files), workspace build, API lint, workspace typecheck, all API tests, discovered Vapp/client tests, release guard tests, API/release-file formatting and `git diff --check`. Prettier also parses the workflow YAML. Vapp's production-configured build runs after the API is healthy; the earlier workspace build is validation only.

The API job uses GitHub environment `dev` and `arn:aws:iam::755905325223:role/VambericGitHubApiDeployRole`. The frontend job uses environment `vapp` and `arn:aws:iam::755905325223:role/VambericDevVapp-VappDeploymentRoleB8CD46CD-y5f4T2p0mWwz`. Keep environment approvals and main-only deployment branch restrictions. OIDC trust must remain scoped to `auriqa-dev/vamberic-platform-api`, the respective environment, and audience `sts.amazonaws.com`. No access keys are used.

Images go to `755905325223.dkr.ecr.eu-west-2.amazonaws.com/vamberic-dev-api:<full SHA>`. The repository must remain immutable. Reruns reuse an existing SHA tag; API releases never move tags. Linux/amd64 matches the existing default Fargate architecture. An architecture change requires a separate infrastructure/pipeline review.

## Image ownership: required infrastructure change

Use an ordinary CloudFormation **String** parameter `ApiImageTag` in **VambericDevApi**, exclusively as the tag of the `api` container image. The application workflow changes this parameter through a change set using **the deployed template**, with every other parameter set to `UsePreviousValue`. CloudFormation registers the task revision and updates its existing ECS service; the pipeline does not directly register revisions or update ECS.

This avoids an ECS/CloudFormation drift trap: CloudFormation owns the task revision throughout. CDK owns the template and all infrastructure properties; the application release owns one parameter value. CDK retains previous parameter values by default. Do not use `--no-previous-parameters`, inject an old tag, or restore a static tag during an infrastructure deployment. See [CDK parameter retention](https://docs.aws.amazon.com/cdk/v2/guide/cli.html) and [CloudFormation previous-template updates](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/update-stack.html).

Infrastructure contract in `vamberic-infrastructure` (implementation inspected read-only; deployment reported by the operator):

- In `lib/api-stack.ts`, for dev, create `new cdk.CfnParameter(this, 'ApiImageTag', { type: 'String', allowedPattern: '[a-f0-9]{7,40}', description: 'Immutable application image tag; retained across infrastructure deployments' })`. **No default.** Use its `.valueAsString` in `ContainerImage.fromEcrRepository`; retain the current prod behavior. Allow a short legacy SHA only to bootstrap the currently running image; application releases enforce full SHA.
- In `bin/vamberic-infrastructure.ts`, bypass `resolveApiImageTag` for dev, and adjust the constructor argument/type as necessary. Dev must neither require nor consume `API_IMAGE_TAG` / `-c imageTag` / a static config value. Keep prod handling unchanged.
- Remove dev's stale `apiImageTag` from `config/dev.ts` (inspection found `5f15a3e`; do not assume this is the live image).
- Manage the API deploy role's additional policy in infrastructure code. Identify/import its existing source; do not create another role with the same name or change trust blindly.
- Add synthesis tests: image uses the parameter, no static dev tag/default remains, the parameter has no other consumers, service/roles/network/env/secrets/logging/health/CPU/memory remain unchanged, circuit breaker rollback stays enabled, and deployment permissions are scoped as below.
- Run infrastructure build, lint, tests, CDK synth and diff check. Review the CloudFormation diff before the separately authorized one-time deployment.

Bootstrap with the **actual currently running immutable tag**, verified by an operator, through `--parameters VambericDevApi:ApiImageTag=<current-tag>`. Do not use this document's historic tag as release state. Resolve any existing ECS/CloudFormation task-revision drift before enabling application releases. Later infrastructure deploys omit this parameter override and retain its current value. No SSM cache, mutable tag, bot commit or local image pin is involved.

A change set must contain only modifications to the existing task definition's `ContainerDefinitions` and the existing service's `TaskDefinition`; service replacement and other changes are rejected before execution. The unchanged template must use the image parameter only in the `api` image. The script never submits a new template. CloudFormation serializes stack updates; schedule manual infrastructure deployments outside application releases. GitHub concurrency serializes API plus Vapp and never cancels a running release. A concurrent external infrastructure update fails safely and requires a rerun.

## IAM prerequisites

Retain existing ECR push permissions. Required read/push permissions for the existing repository:

- `ecr:DescribeRepositories`, `ecr:ListImages`, `ecr:DescribeImages`, `ecr:BatchGetImage`, `ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`, `ecr:CompleteLayerUpload`, `ecr:PutImage` on `arn:aws:ecr:eu-west-2:755905325223:repository/vamberic-dev-api`.
- `ecr:GetAuthorizationToken` on `*` (required by ECR login).

Add to the API GitHub role, limited to account 755905325223 / eu-west-2:

- `cloudformation:DescribeStacks`, `cloudformation:GetTemplate`, `cloudformation:DescribeStackResource`, `cloudformation:CreateChangeSet`, `cloudformation:DescribeChangeSet`, `cloudformation:ExecuteChangeSet`, `cloudformation:DeleteChangeSet` for `arn:aws:cloudformation:eu-west-2:755905325223:stack/VambericDevApi/*`. Put the four change-set actions in a separate statement with `StringLike: { "cloudformation:ChangeSetName": "app-*" }`; these actions authorize against the stack ARN, not a change-set ARN. There is no `UpdateStack`, `CreateStack`, `DeleteStack` or template upload permission in the application path.
- `ecs:DescribeServices` on `arn:aws:ecs:eu-west-2:755905325223:service/vamberic-dev-api/vamberic-dev-api`.
- `ecs:ListTasks` on `*`, restricted using `ecs:cluster` to `arn:aws:ecs:eu-west-2:755905325223:cluster/vamberic-dev-api`.
- `ecs:DescribeTasks` on `arn:aws:ecs:eu-west-2:755905325223:task/vamberic-dev-api/*`.
- `ecs:DescribeTaskDefinition` on `*` (this describe API does not support task-definition resource scoping).

Use the stack's existing CloudFormation execution role; verify its `RoleARN` during rollout. If the caller requires `iam:PassRole`, scope it to **that exact role**, conditioned on `iam:PassedToService = cloudformation.amazonaws.com`. Do not guess the role ARN. The execution role already needs ECS registration/update and `iam:PassRole` to the existing `vamberic-dev-api-task` / `vamberic-dev-api-execution` roles; do not grant these direct write permissions to GitHub for this design. No AdministratorAccess policy is needed for the GitHub role. Executing change sets through a privileged CloudFormation execution role is a deployment capability: protect main, workflow edits and the `dev` environment accordingly. The script's template/change guards supplement IAM; they are not an IAM security boundary.

The existing Vapp role needs its current bucket List/Put/Delete and CloudFront invalidation access, plus `cloudfront:GetInvalidation` for the new completion waiter, scoped to distribution `arn:aws:cloudfront::755905325223:distribution/EUYTHCWBZ81X4`. Current inspection confirms `lib/vapp-stack.ts` grants both `cloudfront:CreateInvalidation` and `cloudfront:GetInvalidation`. Trust and website roles otherwise remain unchanged.

## Health, failures and reruns

After CloudFormation succeeds, the workflow waits for ECS stability and verifies the current service and all running tasks use the expected task definition, image URI and immutable ECR digest. Previous/new task-definition ARNs and digest appear in the job summary. `/health` and `/ready` must return 200 for environment `dev`; `/ready` must contain `status: ready` and `dependencies.mongodb: available`. Checks retry up to 12 times with bounded request timeouts and backoff, without logging response bodies.

CloudFormation and the existing ECS circuit breaker handle deployment failure/rollback. The workflow does not disable rollback or issue custom rollback commands. A failed update, mismatched image, unhealthy API or unavailable MongoDB blocks Vapp. If post-deployment readiness fails after CloudFormation succeeds, the backend may already be updated; investigate and rerun or explicitly roll back using the separate operator process. Vapp failures leave the healthy API deployed; S3 sync is not an atomic frontend rollback. API changes must remain compatible with the previously deployed frontend.

Vapp uses the same API/Cognito build-time values as the former workflow. It verifies `dist/public/index.html`, rechecks backend health, syncs `artifacts/vapp/dist/public/` with `--delete` to `vambericdevvapp-vappbucketf8cb2aac-xzrw6jpr9pbm`, invalidates `EUYTHCWBZ81X4` with `/*`, and waits for completion.

For a manual retry, choose **Deploy dev API and Vapp → Run workflow → main**. The workflow derives its image from that reviewed commit; there is no arbitrary tag input. It rejects a branch other than main or a superseded SHA before API deployment. For a failed old run after main advances, dispatch current main instead. Reusing the immutable tag makes reruns safe after partial completion. The ECR retention policy currently keeps 20 tagged images; older tags may no longer exist, so do not rely on old workflow reruns as a rollback archive.

## Database and other manual deployments

No job runs database setup, schema/Product migrations, CRM deletes or Mongo maintenance. Health/readiness calls only exercise existing readiness checks. `scripts/deploy/policy.json` must set `databaseMigrationRequired: true` in a PR that cannot be safely released before a migration. This stops validation and deployment. Run the separately reviewed manual database process first, then commit a reviewed change setting the flag false. The flag is a review requirement, not automatic detection of schema compatibility; a migration must never be silently added to the workflow.

Infrastructure architecture, HVM, Vamberic public website, Built Matters and Odyssiant deployments remain manual. Emergency application rollback is a deliberate operator action using an existing immutable image through the same CloudFormation parameter; do not edit ECS directly and introduce drift.

## Transition checklist

1. Infrastructure parameter and permission prerequisites are reported complete; retain the contracts above.
2. Bootstrap is reported complete with the existing `5f15a3e` image preserved; do not repeat it to release application code.
3. Verify the `dev` and `vapp` environments restrict deployment to main and retain required approvals.
4. Resolve local build blockers and ensure all validation passes.
5. Merge the platform workflow replacement. The first main push runs the unified pipeline; the old two workflow files are removed in the same change.
6. Verify its summary and both application URLs. No deployment was performed while implementing this pipeline.

## First release failure and cleanup diagnostics

Read-only CloudTrail inspection for release `dc4a1d9ef611b9b0bfdad316459922b986adc811` found:

- 2026-09-23 09:41:14 UTC: the GitHub deployment role received `AccessDenied` for `DescribeChangeSet` on `VambericDevApi`.
- 09:41:15 UTC: failure cleanup attempted `DeleteChangeSet` and received `InvalidChangeSetStatusException` while the change set was `CREATE_IN_PROGRESS`.
- Subsequent read-only inspection found `app-dc4a1d9ef611b9b0bfdad316459922b986adc811-35844221378-1` in `CREATE_COMPLETE` / `AVAILABLE`, with only the intended task-definition and service changes. It was not executed or deleted during investigation.

The old cleanup catch replaced the primary error with its own error, and the AWS wrapper discarded both AWS error codes. The corrected wrapper emits command/waiter, recognized AWS code, known API action and classified safe explanations. It never retains raw subprocess errors, stderr, stdout or command arguments. Unknown/free-form messages are omitted. Cleanup logs a separate secondary failure and rethrows the primary error. Only narrow absent/deleted/consumed change-set cases are no-ops; `AccessDenied`, creation-in-progress and unrecognized failures are not ignored. Successful execution does not run cleanup.

The deployed `VambericDevApiRelease` policy lists Create/Describe/Execute/DeleteChangeSet on `arn:aws:cloudformation:eu-west-2:755905325223:stack/VambericDevApi/*`, conditioned on `cloudformation:ChangeSetName = app-*`. Create succeeded; Describe was denied; Delete reached lifecycle validation; Execute was never attempted. Thus listing all four actions is not proof that the actual Describe request is authorized. The precise condition context is not included in the denied CloudTrail event. Investigate the condition on DescribeChangeSet in **vamberic-infrastructure**; a narrowly scoped DescribeChangeSet read statement for the same stack without the name condition is a candidate correction. Keep write-action restrictions and test the effective permissions there. Do not broaden IAM from platform-api or claim this diagnostic fix alone resolves the authorization failure.

Vapp still depends on successful API deployment, and no migration or rollback mechanism was added. The original failure remains blocking until the infrastructure authorization issue is resolved.
