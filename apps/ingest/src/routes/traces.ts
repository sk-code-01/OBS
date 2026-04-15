import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ApiKeyAuth } from "../auth/api-key.js";
import type { Config } from "../config.js";
import { normalize } from "../ingest/normalize.js";
import type { Queue } from "../ingest/queue.js";
import { TraceBatchSchema } from "../schema/zod.js";
import { resolveProjectIdFromAuthorization } from "./authenticate.js";

const IngestAckSchema = z.object({
  accepted: z.number(),
  rejected: z.number(),
});

const ErrorSchema = z.object({
  error: z.string(),
  retryAfterMs: z.number().optional(),
});

export async function registerTraceRoutes(
  app: FastifyInstance,
  deps: {
    queue: Queue;
    auth: ApiKeyAuth;
    config: Config;
  },
): Promise<void> {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.route({
    method: "POST",
    url: "/v1/traces",
    schema: {
      summary: "Batch-upload spans",
      description:
        "Accepts a batch of spans from an OpenClaw SDK/plugin. " +
        "Responds 202 once queued; spans are persisted asynchronously.",
      tags: ["ingest"],
      body: TraceBatchSchema,
      response: {
        202: IngestAckSchema,
        401: ErrorSchema,
        429: ErrorSchema,
      },
    },
    handler: async (req, reply) => {
      const projectId = await resolveProjectIdFromAuthorization(
        req.headers.authorization,
        deps.auth,
      );
      if (!projectId) {
        return reply.code(401).send({ error: "invalid_api_key" });
      }

      const batch = req.body;
      const rows = batch.spans.map((span) =>
        normalize(span, {
          projectId,
          sdkVersion: batch.sdkVersion,
          maxFieldBytes: deps.config.maxFieldBytes,
        }),
      );

      const accepted = deps.queue.offer(rows);
      if (!accepted) {
        return reply.code(429).send({ error: "queue_full", retryAfterMs: 500 });
      }

      return reply.code(202).send({ accepted: rows.length, rejected: 0 });
    },
  });
}
