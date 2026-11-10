import type { FastifyInstance } from "fastify";
import { toJsonSafe } from "../../eip712.js";
import { ContractNotConfiguredError } from "../../signer.js";
import { closedSeasons, computeSeason, computeStandings, MAX_WINNERS } from "../../season/scoring.js";
import type { Services } from "../../services.js";

export function seasonRoutes(app: FastifyInstance, svc: Services) {
  /** Live ranking of the running season (what `closeSeason` would pay), with the closed seasons for history. */
  app.get("/season/current", async () => {
    const ranking = computeSeason(svc.db);
    return { ...ranking, closed: closedSeasons(svc.db) };
  });

  /**
   * Full live standings of the running season: every scorer (not only the paid top 10) with rank, score breakdown
   * and the share they would get if the season closed now, plus the closed seasons and their on-chain payouts.
   */
  app.get("/season/standings", async () => ({ ...computeStandings(svc.db), maxWinners: MAX_WINNERS, closed: closedSeasons(svc.db) }));

  /** Payouts of one closed season (404 while it is still running or not indexed yet). */
  app.get<{ Params: { season: string } }>("/season/:season/payouts", async (req, reply) => {
    const n = Number(req.params.season);
    if (!Number.isInteger(n) || n < 1) return reply.code(400).send({ error: "season must be a positive integer" });
    const [row] = closedSeasons(svc.db, { season: n });
    if (!row) return reply.code(404).send({ error: `season ${n} is not closed (or not indexed yet)` });
    return row;
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
