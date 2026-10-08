# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable \
    && corepack prepare pnpm@10.26.1 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY lib/api-zod/package.json ./lib/api-zod/package.json
COPY lib/agent-runtime-protocol/package.json ./lib/agent-runtime-protocol/package.json

RUN pnpm install --frozen-lockfile --filter @workspace/api-server...

COPY artifacts/api-server ./artifacts/api-server
COPY lib/api-zod ./lib/api-zod
COPY lib/agent-runtime-protocol ./lib/agent-runtime-protocol

RUN pnpm --filter @workspace/api-server run build
RUN pnpm --filter @workspace/api-server deploy --legacy --prod /runtime-deps

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /workspace/artifacts/api-server/dist ./dist
COPY --from=build --chown=node:node /runtime-deps/node_modules ./node_modules
RUN node --input-type=module -e "import sharp from 'sharp'; await sharp({create:{width:1,height:1,channels:4,background:'#0000'}}).png().toBuffer();"

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "--enable-source-maps", "dist/index.mjs"]