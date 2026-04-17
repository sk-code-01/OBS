FROM node:22-alpine AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/ingest/package.json apps/ingest/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/clickhouse-schema/package.json packages/clickhouse-schema/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

WORKDIR /app

COPY . .

RUN pnpm -F @clawobs/types build
RUN pnpm -F @clawobs/clickhouse-schema build
RUN pnpm -F @clawobs/ingest build

FROM node:22-alpine AS runtime

ENV NODE_ENV="production"

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/ingest/package.json ./apps/ingest/package.json
COPY --from=build /app/apps/ingest/dist ./apps/ingest/dist
COPY --from=build /app/apps/ingest/node_modules ./apps/ingest/node_modules
COPY --from=build /app/packages/types/package.json ./packages/types/package.json
COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/packages/clickhouse-schema/package.json ./packages/clickhouse-schema/package.json
COPY --from=build /app/packages/clickhouse-schema/dist ./packages/clickhouse-schema/dist
COPY --from=build /app/packages/clickhouse-schema/node_modules ./packages/clickhouse-schema/node_modules
COPY --from=build /app/packages/clickhouse-schema/migrations ./packages/clickhouse-schema/migrations

WORKDIR /app/apps/ingest

EXPOSE 4317

CMD ["node", "dist/server.js"]
