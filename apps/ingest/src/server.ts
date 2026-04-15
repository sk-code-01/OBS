import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { createAppClient } from "@clawobs/clickhouse-schema";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { createApiKeyAuth } from "./auth/api-key.js";
import { type Config, loadConfig } from "./config.js";
import { createQueue } from "./ingest/queue.js";
import { createWriter } from "./ingest/writer.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerTraceRoutes } from "./routes/traces.js";

export interface BuiltApp {
  app: FastifyInstance;
  close: () => Promise<void>;
}

/**
 * Construct the Fastify app with all routes wired. Exported for tests so
 * they can build an isolated instance without binding a port.
 */
export async function buildApp(config: Config = loadConfig()): Promise<BuiltApp> {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: config.maxPayloadBytes,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const clickhouse = createAppClient({
    url: config.clickhouseUrl,
    database: config.clickhouseDb,
    username: config.clickhouseUser,
    password: config.clickhousePassword,
  });

  const writer = createWriter(clickhouse);
  const queue = createQueue(writer, {
    maxSpans: config.batchMaxSpans,
    maxMs: config.batchMaxMs,
    maxDepth: config.queueMaxDepth,
    onError: (err, n) => {
      app.log.error({ err, droppedRows: n }, "failed to flush spans to ClickHouse");
    },
  });

  const auth = createApiKeyAuth(clickhouse, config.apiKeyCacheTtlMs);

  await app.register(swagger, {
    openapi: {
      info: {
        title: "ClawObs Ingest API",
        version: "0.1.0",
        description: "Observability ingestion for OpenClaw.",
      },
      servers: [{ url: `http://localhost:${config.port}` }],
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer" },
        },
      },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });

  await registerHealthRoutes(app, { clickhouse });
  await registerTraceRoutes(app, { queue, auth, config });
  await registerEventRoutes(app, { queue, auth, config });
  await registerQueryRoutes(app, { clickhouse, auth });

  const close = async (): Promise<void> => {
    await queue.close();
    await clickhouse.close();
    await app.close();
  };

  return { app, close };
}

// Entry point: `node dist/server.js` or `tsx src/server.ts`.
// Detect direct execution by comparing `import.meta.url` against argv[1].
const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : "";
if (import.meta.url === invokedPath) {
  const config = loadConfig();
  buildApp(config)
    .then(async ({ app, close }) => {
      await app.listen({ port: config.port, host: config.host });
      const shutdown = async (signal: string) => {
        app.log.info({ signal }, "shutting down");
        await close();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown("SIGINT"));
      process.on("SIGTERM", () => void shutdown("SIGTERM"));
    })
    .catch((err) => {
      // biome-ignore lint/suspicious/noConsole: startup failure
      console.error("failed to start ingest server:", err);
      process.exit(1);
    });
}
