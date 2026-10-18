# HVM dev API deployment

Pushes to `main` and manual runs of **Deploy dev HVM API** (`.github/workflows/deploy-dev.yml`) validate and deploy the API. The HVM frontend has its own workflow in `auriqa-dev/hvm-app`. This workflow does not deploy the legacy Vapp, worker, infrastructure, credentials, or database migrations.

## Release gate

Use Node 24 and pnpm 10.26.1. Run `pnpm install --frozen-lockfile`, then `bash scripts/deploy/validate.sh`. Every gate must pass: generated-client consistency, workspace build, API lint, workspace typecheck, the complete API suite, discovered client tests, deployment guard tests, formatting and whitespace checks. Optional external-service tests retain their existing explicit prerequisites; normal HTTP tests run on loopback.

API tests prepare hash-verified cross-repository snapshots in `.integration/` inside this checkout. They never depend on neighboring working copies or require cross-repository credentials. `scripts/deploy/fixtures/manifest.json` records the deployed frontend commit, worker image and archive checksums. The separate historical PSU frontend snapshot tests compatibility of retained Run endpoints; it is not the current app. Calibration pins remain unchanged. Dependency links reuse the frozen workspace lockfile, with Zod 3 for the frontend and Zod 4 for the worker. Snapshots are test inputs only and excluded from Docker context. When a coordinated frontend/worker contract changes, refresh the relevant reviewed snapshot and checksum together; never regenerate expected migration or calibration hashes to make a failure pass.

Client administrators retain Queen authority within their own workspace. Viewer grants, tenant boundaries and separate Empress powers remain enforced. Retired commercial/PSU authoring remains rejected without writes; historical commercial review remains available only through its authorized projection. Tests reflect these current contracts.

## Image ownership and verification

GitHub environment `dev` assumes `arn:aws:iam::755905325223:role/VambericGitHubApiDeployRole` through OIDC. Both validation and deployment reject a superseded main revision. Deployment concurrency does not cancel a running release.

The immutable ECR tag is the complete Git commit SHA in `755905325223.dkr.ecr.eu-west-2.amazonaws.com/vamberic-dev-api`. Reruns reuse that tag. The deployment changes only `ApiImageDigest` on `VambericDevApi`, using its previous template and all other parameter values. CloudFormation retains ownership of the ECS task definition and service. Preconditions reject drift, mutable ECR tags, unexpected image consumers and a missing deployment circuit breaker. The reviewed change set must contain only the expected task/service image rollout. No environment values, secrets, service roles or network configuration are published in logs.

The workflow verifies the resulting CloudFormation task definition, one stable ECS deployment, desired running count and the exact image digest of each running API container. Public `/health` and `/ready` must return dev health and MongoDB availability. A failed check fails the release; it is never converted into success. ECS circuit-breaker rollback is enabled. If post-deployment acceptance fails after ECS stabilization, restore the recorded previous digest through an image-only CloudFormation change set, then repeat health and readiness checks. Do not make direct ECS changes that leave CloudFormation drift.

The GitHub role needs scoped CloudFormation describe/create/execute/delete-change-set actions, ECR publish/read actions and ECS read/wait actions. Change-set actions are authorized against the stack ARN with an `app-*` change-set-name condition. Retain the existing CloudFormation execution role, OIDC trust restrictions and environment protections. Broader IAM or infrastructure changes require separate review.

## Database recovery

`databaseMigrationRequired` must remain false for this routine path. Schema changes require their separate reviewed migration and established recovery process. Historical migration definitions and fingerprints are immutable. Later additive index definitions must not leak into earlier migration targets. This workflow never runs setup commands or writes application records.
