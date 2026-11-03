import type { FastifyInstance } from "fastify";
import { toJsonSafe } from "../../eip712.js";
import { ContractNotConfiguredError } from "../../signer.js";
import { computeSeason } from "../../season/scoring.js";
import type { Services } from "../../services.js";

export function seasonRoutes(app: FastifyInstance, svc: Services) {
  /** Live ranking of the running season (what `closeSeason` would pay), with the closed seasons for history. */
  app.get("/season/current", async () => {
    const ranking = computeSeason(svc.db);
    const closed = svc.db.prepare("SELECT season, pool, block_number AS block, tx_hash AS hash FROM seasons ORDER BY season DESC LIMIT 10").all();
    return { ...ranking, closed };
  });

  /**
   * Signs the ranking the server itself computed (it never signs a ranking supplied by a caller) as an EIP-712
   * SeasonResult. Only the contract admin can submit it, and only after `seasonEnd`.
   */
  app.post("/season/close-proof", async (_req, reply) => {
    const ranking = computeSeason(svc.db);
    try {
      const signed = await svc.signer.signSeasonResult({
        season: BigInt(ranking.season),
        players: ranking.players.map((p) => p.address),
        creators: ranking.creators.map((c) => c.address),
        shares: ranking.shares.map((s) => BigInt(s)),
      });
      return { ranking, message: toJsonSafe(signed.message), signature: signed.signature, signer: signed.signer };
    } catch (err) {
      if (err instanceof ContractNotConfiguredError) return reply.code(503).send({ error: err.message });
      throw err;
    }
  });
}
