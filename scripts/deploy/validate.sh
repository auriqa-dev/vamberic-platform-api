#!/usr/bin/env bash
set -euo pipefail
node --input-type=module -e 'import {validatePolicy} from "./scripts/deploy/release.mjs"; import fs from "node:fs"; validatePolicy(JSON.parse(fs.readFileSync("scripts/deploy/policy.json")));'
pnpm --filter @workspace/api-spec run codegen
test -z "$(git status --porcelain -- lib/api-client-react/src/generated lib/api-zod/src/generated)"
PORT=3000 BASE_PATH=/ pnpm run build
pnpm --filter @workspace/api-server run lint
pnpm run typecheck
pnpm --filter @workspace/api-server run test
node scripts/deploy/test-client.mjs
node --test scripts/deploy/release.test.mjs
pnpm --filter @workspace/api-server run format:check
pnpm exec prettier --check .github/workflows/deploy-dev.yml 'scripts/deploy/*.mjs' scripts/deploy/policy.json docs/dev-deployment.md README.md
git diff --check
