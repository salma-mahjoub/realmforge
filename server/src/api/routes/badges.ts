import type { FastifyInstance } from "fastify";
import { toJsonSafe } from "../../eip712.js";
import { ContractNotConfiguredError } from "../../signer.js";
import type { Services } from "../../services.js";
import { addressSchema } from "../schemas.js";
import { badRequest } from "../errors.js";

const BADGES = ["", "First Clear", "Record Holder", "Race Winner", "Creator"] as const;
type Award = { badgeId: number; ref: string; name: string; description: string };

function eligible(svc: Services, holder: string): Award[] {
  const out: Award[] = [];
  const firstClears = svc.db.prepare(
    `SELECT r.level_id AS ref FROM runs r JOIN levels l ON l.id = r.level_id
     WHERE r.cleared = 1 AND r.player = ? AND r.player != l.creator
       AND r.id = (SELECT MIN(r2.id) FROM runs r2 WHERE r2.level_id = r.level_id AND r2.cleared = 1 AND r2.player != l.creator)
     ORDER BY r.id`,
  ).all(holder) as { ref: number }[];
  for (const r of firstClears) out.push({ badgeId: 1, ref: String(r.ref), name: BADGES[1], description: `First clear of level #${r.ref}` });
  const records = svc.db.prepare("SELECT id AS ref FROM levels WHERE best_player = ? ORDER BY id").all(holder) as { ref: number }[];
  for (const r of records) out.push({ badgeId: 2, ref: String(r.ref), name: BADGES[2], description: `Record holder on level #${r.ref}` });
  const races = svc.db.prepare("SELECT room_id AS ref FROM races WHERE status = 'settled' AND ranking IS NOT NULL ORDER BY updated_block").all() as { ref: string }[];
  for (const r of races) {
    const race = svc.db.prepare("SELECT ranking FROM races WHERE room_id = ?").get(r.ref) as { ranking: string };
    if (JSON.parse(race.ranking)[0]?.toLowerCase() === holder) out.push({ badgeId: 3, ref: BigInt(r.ref).toString(), name: BADGES[3], description: "Won a settled race" });
  }
  const created = svc.db.prepare("SELECT id AS ref FROM levels WHERE creator = ? ORDER BY id").all(holder) as { ref: number }[];
  for (const r of created) out.push({ badgeId: 4, ref: String(r.ref), name: BADGES[4], description: `Published level #${r.ref}` });
  return out;
}

export function badgeRoutes(app: FastifyInstance, svc: Services) {
  app.get("/profiles/:address/badges", async (req, reply) => {
    const parsed = addressSchema.safeParse((req.params as { address: string }).address);
    if (!parsed.success) return badRequest(reply, "invalid address");
    const holder = parsed.data.toLowerCase();
    const all = eligible(svc, holder);
    const earnedRows = svc.db.prepare("SELECT badge_id AS badgeId, ref, tx_hash AS hash FROM badge_claims WHERE holder = ? ORDER BY rowid").all(holder) as { badgeId: number; ref: string; hash: string }[];
    const earnedKeys = new Set(earnedRows.map((x) => `${x.badgeId}:${x.ref}`));
    const earned = earnedRows.map((x) => ({ ...x, name: BADGES[x.badgeId] }));
    return { address: holder, earned, claimable: all.filter((x) => !earnedKeys.has(`${x.badgeId}:${x.ref}`)) };
  });

  app.post("/badges/claim-proof", async (req, reply) => {
    const body = req.body as { holder?: unknown; badgeId?: unknown; ref?: unknown };
    const address = addressSchema.safeParse(body?.holder);
    if (!address.success || !Number.isInteger(body?.badgeId) || Number(body.badgeId) < 1 || Number(body.badgeId) > 4 || !/^\d+$/.test(String(body?.ref))) {
      return badRequest(reply, "invalid badge claim");
    }
    const holder = address.data.toLowerCase();
    const badgeId = Number(body.badgeId);
    const ref = BigInt(String(body.ref));
    if (!eligible(svc, holder).some((x) => x.badgeId === badgeId && BigInt(x.ref) === ref)) return reply.code(403).send({ error: "badge not earned" });
    const already = svc.db.prepare("SELECT 1 FROM badge_claims WHERE holder = ? AND badge_id = ? AND ref = ?").get(holder, badgeId, ref.toString());
    if (already) return reply.code(409).send({ error: "badge already claimed" });
    try {
      const signed = await svc.signer.signBadgeClaim({ holder: address.data, badgeId: BigInt(badgeId), ref });
      return { message: toJsonSafe(signed.message), signature: signed.signature, signer: signed.signer };
    } catch (err) {
      if (err instanceof ContractNotConfiguredError) return reply.code(503).send({ error: err.message });
      throw err;
    }
  });
}
