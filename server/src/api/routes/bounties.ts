import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { isAddress, type Address } from "viem";
import { toJsonSafe } from "../../eip712.js";
import type { Services } from "../../services.js";
import { ContractNotConfiguredError } from "../../signer.js";
import { idParamSchema, runValidateBodySchema } from "../schemas.js";
import { badRequest, zodDetails } from "../errors.js";

const claimBody = z.object({ player: z.string().refine((v) => isAddress(v), "invalid address").transform((v) => v as Address), levelId: z.coerce.bigint().positive(), bountyId: z.coerce.bigint().positive(), run: runValidateBodySchema.shape.run });

export function bountyRoutes(app: FastifyInstance, svc: Services) {
  app.post("/bounties/claim-proof", async (req, reply) => {
    const body = claimBody.safeParse(req.body);
    if (!body.success) return badRequest(reply, "invalid body", zodDetails(body.error));
    const { player, bountyId, run } = body.data;
    if (!run.cleared) return badRequest(reply, "run did not clear the level");
    const { levelId } = body.data;
    const pinned = svc.levels.getByLevelId(levelId);
    if (!pinned) return reply.code(404).send({ error: "level unknown" });
    const result = await svc.validator.validate(pinned.level, run, pinned.analysis);
    if (!result.ok) return reply.code(422).send({ error: "run rejected", issues: result.issues });
    const bounty = svc.db.prepare("SELECT level_id, target_time_ms, expiry, status FROM bounties WHERE bounty_id = ?").get(bountyId.toString()) as
      | { level_id: number; target_time_ms: number; expiry: number; status: string }
      | undefined;
    if (!bounty || bounty.status !== "open") return reply.code(404).send({ error: "bounty not open or not indexed" });
    if (BigInt(bounty.level_id) !== levelId) return badRequest(reply, "bounty belongs to another level");
    if (bounty.expiry && Math.floor(Date.now() / 1000) >= bounty.expiry) return reply.code(409).send({ error: "bounty expired" });
    if (bounty.target_time_ms && run.timeMs > bounty.target_time_ms) return reply.code(422).send({ error: "clear did not beat bounty target time" });
    const level = svc.db.prepare("SELECT owner, creator FROM levels WHERE id = ?").get(Number(levelId)) as { owner: string; creator: string } | undefined;
    const contribution = svc.db.prepare("SELECT 1 FROM bounty_contributions WHERE bounty_id = ? AND sponsor = ? AND CAST(amount AS TEXT) != '0'").get(bountyId.toString(), player.toLowerCase());
    if (!level || player.toLowerCase() === level.owner || player.toLowerCase() === level.creator || contribution) return reply.code(403).send({ error: "level owners, creators and bounty sponsors cannot claim" });
    try {
      const signed = await svc.signer.signBountyClaim({ bountyId, levelId, player, timeMs: run.timeMs });
      return { claim: toJsonSafe(signed.message), signature: signed.signature, signer: signed.signer };
    } catch (err) {
      if (err instanceof ContractNotConfiguredError) return reply.code(503).send({ error: err.message });
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>("/levels/:id/bounties", async (req, reply) => {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return badRequest(reply, "invalid id");
    const rows = svc.db.prepare("SELECT bounty_id AS bountyId, level_id AS levelId, sponsor, target_time_ms AS targetTimeMs, expiry, amount, status, winner, time_ms AS timeMs, tx_hash AS txHash FROM bounties WHERE level_id = ? ORDER BY bounty_id DESC").all(p.data.id) as { bountyId: number }[];
    const contributions = svc.db.prepare("SELECT sponsor FROM bounty_contributions WHERE bounty_id = ? AND amount != '0'");
    return { levelId: p.data.id, bounties: rows.map((b) => ({ ...b, sponsors: (contributions.all(b.bountyId) as { sponsor: string }[]).map((r) => r.sponsor) })) };
  });
}
