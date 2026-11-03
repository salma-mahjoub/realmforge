import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { toJsonSafe } from "../../eip712.js";
import { ContractNotConfiguredError } from "../../signer.js";
import type { Services } from "../../services.js";
import { badRequest, zodDetails } from "../errors.js";
import { runValidateBodySchema } from "../schemas.js";

export function runRoutes(app: FastifyInstance, svc: Services) {
  /**
   * Solo run validation (SPEC §3.6) -> EIP-712 RunResult signed for ForgeCoin.settleRun.
   * The level must be indexed (levelId -> layoutHash) and its JSON known to this server.
   */
  app.post("/runs/validate", async (req, reply) => {
    const body = runValidateBodySchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, "invalid body", zodDetails(body.error));
    const { player, levelId, run } = body.data;

    const pinned = svc.levels.getByLevelId(levelId);
    if (!pinned) {
      return reply.code(404).send({ error: "level unknown (not indexed yet, or its JSON was not pinned through this server)" });
    }
    const result = await svc.validator.validate(pinned.level, run, pinned.analysis);
    if (!result.ok) return reply.code(422).send({ error: "run rejected", issues: result.issues });

    // The signed nonce is random, so the chain cannot tell two submissions of the same recording apart:
    // the server must. A fingerprint is claimed *before* signing (insert-first keeps it atomic) and
    // released if signing fails so the player can retry. Keyed per level, so copying another player's
    // recording is refused too. A bot that perturbs its trace still gets through (THREAT_MODEL T6).
    const runHash = createHash("sha256").update(JSON.stringify(run)).digest("hex");
    const claimed = svc.db
      .prepare("INSERT OR IGNORE INTO run_fingerprints (level_id, run_hash, player, created_at) VALUES (?, ?, ?, ?)")
      .run(levelId.toString(), runHash, player.toLowerCase(), Date.now());
    if (claimed.changes === 0) return reply.code(409).send({ error: "run already submitted: play the level again" });

    try {
      const signed = await svc.signer.signRunResult({
        player,
        levelId,
        timeMs: run.timeMs,
        cleared: run.cleared,
        coins: run.coins,
      });
      svc.db
        .prepare(
          `INSERT INTO signed_runs (nonce, kind, player, level_id, layout_hash, time_ms, cleared, coins, input_log, created_at)
           VALUES (?, 'run', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          signed.message.nonce.toString(),
          player.toLowerCase(),
          levelId.toString(),
          pinned.layoutHash,
          run.timeMs,
          run.cleared ? 1 : 0,
          run.coins,
          run.inputLog ?? null,
          Date.now(),
        );
      return { result: toJsonSafe(signed.message), signature: signed.signature, signer: signed.signer };
    } catch (err) {
      svc.db.prepare("DELETE FROM run_fingerprints WHERE level_id = ? AND run_hash = ?").run(levelId.toString(), runHash);
      if (err instanceof ContractNotConfiguredError) return reply.code(503).send({ error: err.message });
      throw err;
    }
  });
}
