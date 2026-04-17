FROM node:22-alpine AS deps

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/clickhouse-schema/package.json packages/clickhouse-schema/package.json

RUN pnpm install --frozen-lockfile

FROM deps AS build

WORKDIR /app

COPY . .

RUN pnpm -F @clawobs/clickhouse-schema build
RUN pnpm -F @clawobs/web build

FROM node:22-alpine AS runtime

ENV NODE_ENV="production"
ENV PORT=3000
ENV HOST=0.0.0.0

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/.next/standalone/packages ./packages
COPY --from=build /app/apps/web/.next/standalone/apps/web ./apps/web
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/drizzle ./apps/web/drizzle
COPY --from=build /app/apps/web/scripts ./apps/web/scripts

EXPOSE 3000

CMD ["sh", "-c", "node apps/web/scripts/migrate.mjs && node apps/web/server.js"]
