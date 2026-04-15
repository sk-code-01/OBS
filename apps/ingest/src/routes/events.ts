import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { ApiKeyAuth } from "../auth/api-key.js";
import type { Config } from "../config.js";
import { normalize } from "../ingest/normalize.js";
import type { Queue } from "../ingest/queue.js";
import { SingleEventSchema } from "../schema/zod.js";
import { resolveProjectIdFromAuthorization } from "./authenticate.js";

const IngestAckSchema = z.object({
  accepted: z.number(),
  rejected: z.number(),
});

const ErrorSchema = z.object({
  error: z.string(),
  retryAfterMs: z.number().optional(),
});

/**
 * Single-span convenience endpoint. Internally forwards to the same queue
 * as /v1/traces. Intended for SDKs or tests that don't batch.
 */
export async function registerEventRoutes(
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
    url: "/v1/events",
    schema: {
      summary: "Upload a single span",
      tags: ["ingest"],
      body: SingleEventSchema,
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

      const { sdkVersion, ...span } = req.body;
      const row = normalize(span, {
        projectId,
        sdkVersion,
        maxFieldBytes: deps.config.maxFieldBytes,
      });

      const accepted = deps.queue.offer([row]);
      if (!accepted) {
        return reply.code(429).send({ error: "queue_full", retryAfterMs: 500 });
      }

      return reply.code(202).send({ accepted: 1, rejected: 0 });
    },
  });
}
