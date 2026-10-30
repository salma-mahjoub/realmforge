import type { FastifyReply } from "fastify";
import type { z } from "zod";

export function badRequest(reply: FastifyReply, error: string, details?: unknown) {
  return reply.code(400).send({ error, details });
}

export function zodDetails(err: z.ZodError) {
  return err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}
