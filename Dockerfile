# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable \
    && corepack prepare pnpm@10.26.1 --activate

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY lib/api-zod/package.json ./lib/api-zod/package.json

RUN pnpm install --frozen-lockfile --filter @workspace/api-server...

COPY artifacts/api-server ./artifacts/api-server
COPY lib/api-zod ./lib/api-zod

RUN pnpm --filter @workspace/api-server run build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /workspace/artifacts/api-server/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "--enable-source-maps", "dist/index.mjs"]