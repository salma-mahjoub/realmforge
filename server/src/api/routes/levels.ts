import type { FastifyInstance } from "fastify";
import { canonicalize, layoutHash } from "../../level/canonical.js";
import { analyzeLevel } from "../../level/analysis.js";
import { levelSchema } from "../../level/schema.js";
import { ContractNotConfiguredError } from "../../signer.js";
import { toJsonSafe } from "../../eip712.js";
import type { Services } from "../../services.js";
import { badRequest, zodDetails } from "../errors.js";
import { clearProofBodySchema, idParamSchema, listQuerySchema, pinBodySchema } from "../schemas.js";

function decodeImage(input: string): { bytes: Uint8Array; type: string; ext: string } | null {
  const m = /^data:(image\/(png|jpeg|webp));base64,(.+)$/s.exec(input);
  const type = m ? m[1] : "image/png";
  const b64 = m ? m[3] : input;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) return null;
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) return null;
  return { bytes, type, ext: type.split("/")[1] };
}

/** Level name/theme from the pinned JSON (null when the level was not pinned through this server). */
const META_COLS = "json_extract(p.json, '$.meta.name') AS name, json_extract(p.json, '$.meta.theme') AS theme";

export function levelRoutes(app: FastifyInstance, svc: Services) {
  /**
   * Validate a level (SPEC §3.4), compute layoutHash = keccak256(canonical JSON) and
   * pin level JSON (+ thumbnail + ERC-721 metadata) to IPFS.
   */
  app.post("/levels/pin", async (req, reply) => {
    const body = pinBodySchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, "invalid body", zodDetails(body.error));
    const parsed = levelSchema.safeParse(body.data.level);
    if (!parsed.success) return badRequest(reply, "invalid level", zodDetails(parsed.error));

    const level = parsed.data;
    const canonical = canonicalize(level);
    const hash = layoutHash(level);
    const analysis = analyzeLevel(level);
    const enc = new TextEncoder();

    const levelPin = await svc.pinner.pin(enc.encode(canonical), `level-${hash}.json`, "application/json");

    let thumbnailCid: string | null = null;
    if (body.data.thumbnail) {
      const img = decodeImage(body.data.thumbnail);
      if (!img) return badRequest(reply, "invalid thumbnail (expected base64 png/jpeg/webp)");
      thumbnailCid = (await svc.pinner.pin(img.bytes, `thumb-${hash}.${img.ext}`, img.type)).cid;
    }

    const metadata = {
      name: level.meta.name,
      description: body.data.description ?? `RealmForge level "${level.meta.name}"`,
      ...(thumbnailCid ? { image: `ipfs://${thumbnailCid}` } : {}),
      attributes: [
        { trait_type: "theme", value: level.meta.theme },
        { trait_type: "width", value: level.size.w },
        { trait_type: "height", value: level.size.h },
        { trait_type: "entities", value: level.entities.length },
        { trait_type: "timeLimit", value: level.meta.timeLimit },
      ],
      properties: { schema: level.schema, layoutHash: hash, level: `ipfs://${levelPin.cid}`, minTimeMs: analysis.minTimeMs },
    };
    const metadataCid = (await svc.pinner.pin(enc.encode(canonicalize(metadata)), `metadata-${hash}.json`, "application/json")).cid;

    svc.levels.savePinned({
      layoutHash: hash,
      levelCid: levelPin.cid,
      metadataCid,
      thumbnailCid,
      minTimeMs: analysis.minTimeMs,
      level,
      canonicalJson: canonical,
    });

    return reply.code(201).send({
      layoutHash: hash,
      levelCid: levelPin.cid,
      thumbnailCid,
      metadataCid,
      tokenURI: `ipfs://${metadataCid}`,
      minTimeMs: analysis.minTimeMs,
      provider: levelPin.provider,
      alreadyPublished: svc.levels.isPublished(hash),
    });
  });

  /** Dev gateway for files stored by the local pinner. */
  app.get<{ Params: { cid: string } }>("/ipfs/:cid", async (req, reply) => {
    const bytes = await svc.localPinner.get(req.params.cid);
    if (!bytes) return reply.code(404).send({ error: "not found" });
    const isJson = bytes[0] === 0x7b; // '{'
    return reply.type(isJson ? "application/json" : "application/octet-stream").send(bytes);
  });

  /**
   * Clear check (SPEC §3.3 publish step 1): the creator must finish their own level.
   * Validates the run and returns an EIP-712 ClearProof signed for LevelNFT.publish.
   */
  app.post("/levels/clear-proof", async (req, reply) => {
    const body = clearProofBodySchema.safeParse(req.body);
    if (!body.success) return badRequest(reply, "invalid body", zodDetails(body.error));
    const { creator, layoutHash: hash, run } = body.data;

    const pinned = svc.levels.getByHash(hash);
    if (!pinned) return reply.code(404).send({ error: "level not pinned through this server (POST /levels/pin first)" });
    if (svc.levels.isPublished(hash)) return reply.code(409).send({ error: "layoutHash already published" });
    if (!run.cleared) return badRequest(reply, "run did not clear the level");

    const result = await svc.validator.validate(pinned.level, run, pinned.analysis);
    if (!result.ok) return reply.code(422).send({ error: "run rejected", issues: result.issues });

    try {
      const signed = await svc.signer.signClearProof({ creator, layoutHash: hash });
      return {
        proof: toJsonSafe(signed.message),
        signature: signed.signature,
        signer: signed.signer,
        tokenURI: pinned.metadataCid ? `ipfs://${pinned.metadataCid}` : null,
      };
    } catch (err) {
      if (err instanceof ContractNotConfiguredError) return reply.code(503).send({ error: err.message });
      throw err;
    }
  });

  app.get("/levels", async (req, reply) => {
    const q = listQuerySchema.safeParse(req.query);
    if (!q.success) return badRequest(reply, "invalid query", zodDetails(q.error));
    const { sort, creator, owner, limit, offset } = q.data;
    const where: string[] = ["l.active = 1"];
    const params: (string | number)[] = [];
    if (creator) (where.push("l.creator = ?"), params.push(creator.toLowerCase()));
    if (owner) (where.push("l.owner = ?"), params.push(owner.toLowerCase()));
    const order = {
      new: "l.id DESC",
      popular: "l.plays DESC, l.id DESC",
      liked: "l.likes DESC, l.id DESC",
      hardest: "CASE WHEN l.plays = 0 THEN 1 ELSE 0 END, CAST(l.clears AS REAL) / MAX(l.plays, 1) ASC, l.plays DESC",
    }[sort];
    const rows = svc.db
      .prepare(
        `SELECT l.*, p.level_cid, p.metadata_cid, p.thumbnail_cid, p.min_time_ms, ${META_COLS}
         FROM levels l LEFT JOIN pinned_levels p ON p.layout_hash = l.layout_hash
         WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);
    return { items: rows, limit, offset, sort };
  });

  app.get("/levels/:id", async (req, reply) => {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return badRequest(reply, "invalid id");
    const row = svc.db
      .prepare(
        `SELECT l.*, p.level_cid, p.metadata_cid, p.thumbnail_cid, p.min_time_ms, ${META_COLS}
         FROM levels l LEFT JOIN pinned_levels p ON p.layout_hash = l.layout_hash WHERE l.id = ?`,
      )
      .get(p.data.id);
    if (!row) return reply.code(404).send({ error: "level not indexed" });
    return row;
  });

  /** Pinned level.v1 JSON (canonical bytes, keccak256 == layoutHash) of an on-chain level. */
  app.get("/levels/:id/file", async (req, reply) => {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return badRequest(reply, "invalid id");
    const hash = svc.levels.hashForLevelId(p.data.id);
    if (!hash) return reply.code(404).send({ error: "level not indexed" });
    const row = svc.db.prepare("SELECT json FROM pinned_levels WHERE layout_hash = ?").get(hash.toLowerCase()) as { json: string } | undefined;
    if (!row) return reply.code(404).send({ error: "level JSON not pinned through this server" });
    return reply.type("application/json").send(row.json);
  });

  /** Best on-chain (settled) time per player. */
  app.get("/levels/:id/leaderboard", async (req, reply) => {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return badRequest(reply, "invalid id");
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 50) || 50, 1), 100);
    const rows = svc.db
      .prepare(
        `SELECT player, MIN(time_ms) AS timeMs, COUNT(*) AS clears
         FROM runs WHERE level_id = ? AND cleared = 1
         GROUP BY player ORDER BY timeMs ASC, player ASC LIMIT ?`,
      )
      .all(p.data.id, limit) as { player: string; timeMs: number; clears: number }[];
    return { levelId: p.data.id, entries: rows.map((r, i) => ({ rank: i + 1, ...r })) };
  });

  /** Top replays (input logs of server-validated runs) for ghost races (SPEC §3.5). */
  app.get("/levels/:id/replays", async (req, reply) => {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return badRequest(reply, "invalid id");
    const rows = svc.db
      .prepare(
        `SELECT player, time_ms AS timeMs, input_log AS inputLog, created_at AS createdAt FROM signed_runs
         WHERE level_id = ? AND cleared = 1 AND input_log IS NOT NULL ORDER BY time_ms ASC LIMIT 3`,
      )
      .all(String(p.data.id));
    return { levelId: p.data.id, replays: rows };
  });
}
