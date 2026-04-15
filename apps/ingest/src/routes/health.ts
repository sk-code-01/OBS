import type { ClickHouseClient } from "@clickhouse/client";
import type { FastifyInstance } from "fastify";

export async function registerHealthRoutes(
  app: FastifyInstance,
  deps: { clickhouse: ClickHouseClient },
): Promise<void> {
  app.get("/healthz", async () => ({ ok: true }));

  app.get("/readyz", async (_req, reply) => {
    try {
      await deps.clickhouse.ping();
      return { ok: true };
    } catch (err) {
      reply.code(503);
      return { ok: false, error: (err as Error).message };
    }
  });
}
