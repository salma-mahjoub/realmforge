import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SiweError } from "../../auth/siwe.js";
import type { Services } from "../../services.js";
import { badRequest, zodDetails } from "../errors.js";

const verifyBodySchema = z.object({
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).max(1024),
});

/** Sign-In With Ethereum (EIP-4361): nonce, then verify -> short-lived session token (see auth/siwe.ts). */
export function authRoutes(app: FastifyInstance, svc: Services) {
  app.get("/auth/nonce", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    return svc.sessions.issueNonce();
  });

  app.post("/auth/verify", async (req, reply) => {
    const body = verifyBodySchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, "invalid body", zodDetails(body.error));
    try {
      const session = await svc.sessions.verify(body.data.message, body.data.signature, req.headers.origin);
      return { ...session, ttlSec: svc.sessions.ttlSec };
    } catch (err) {
      if (err instanceof SiweError) return reply.code(401).send({ error: `sign-in rejected: ${err.message}` });
      throw err;
    }
  });

  /** Lets a client check a stored token before relying on it (Authorization: Bearer <token>). */
  app.get("/auth/session", async (req, reply) => {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    const session = m ? svc.sessions.verifyToken(m[1]) : null;
    if (!session) return reply.code(401).send({ error: "no valid session" });
    return { address: session.sub, expiresAt: session.exp * 1000 };
  });
}
