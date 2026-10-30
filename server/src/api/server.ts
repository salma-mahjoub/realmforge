import Fastify, { type FastifyInstance } from "fastify";
import type { Services } from "../services.js";
import { levelRoutes } from "./routes/levels.js";
import { runRoutes } from "./routes/runs.js";

const startedAt = Date.now();

export async function buildApi(svc: Services, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ? { level: svc.config.LOG_LEVEL } : false,
    bodyLimit: 8 * 1024 * 1024,
  });

  // Minimal CORS (avoids an extra plugin). CORS_ORIGIN may be "*" or a comma-separated list.
  const allowed = svc.config.CORS_ORIGIN.split(",").map((s) => s.trim());
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (allowed.includes("*")) reply.header("Access-Control-Allow-Origin", "*");
    else if (origin && allowed.includes(origin)) {
      reply.header("Access-Control-Allow-Origin", origin);
      reply.header("Vary", "Origin");
    }
    reply.header("Access-Control-Allow-Headers", "content-type");
    reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") return reply.code(204).send();
  });

  app.get("/health", async () => {
    const lastBlocks = svc.db.prepare("SELECT key, value FROM indexer_state").all() as { key: string; value: string }[];
    return {
      status: "ok",
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      chainId: svc.config.CHAIN_ID,
      signer: svc.signer.address,
      contracts: {
        levelNFT: svc.config.LEVEL_NFT_ADDRESS ?? null,
        forgeCoin: svc.config.FORGE_COIN_ADDRESS ?? null,
      },
      ipfs: svc.pinner.provider,
      indexer: Object.fromEntries(lastBlocks.map((r) => [r.key, r.value])),
    };
  });

  levelRoutes(app, svc);
  runRoutes(app, svc);
  return app;
}
