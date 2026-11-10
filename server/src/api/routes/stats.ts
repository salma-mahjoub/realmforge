import type { FastifyInstance } from "fastify";
import { formatUnits } from "viem";
import type { Services } from "../../services.js";
import { badRequest } from "../errors.js";
import { addressSchema, idParamSchema } from "../schemas.js";
import { LEVEL_SELECT } from "../queries.js";

/** What the owner of a level has been paid in FORGE (play-fee share + race share), in wei, and per UTC day. */
export function ownerEarnings(svc: Services, levelId: number) {
  const rows = svc.db
    .prepare("SELECT owner_amt AS amt, strftime('%Y-%m-%d', created_at / 1000, 'unixepoch') AS day FROM fee_splits WHERE level_id = ? ORDER BY id")
    .all(levelId) as { amt: string; day: string }[];
  const perDay = new Map<string, bigint>();
  let total = 0n;
  for (const r of rows) {
    const v = BigInt(r.amt);
    total += v;
    perDay.set(r.day, (perDay.get(r.day) ?? 0n) + v);
  }
  return { total: total.toString(), days: [...perDay].map(([day, wei]) => ({ day, forge: Number(formatUnits(wei, 18)) })) };
}

/** Read models for the profile, the market and the per-level activity/earnings panels (all derived from indexed events). */
export function statsRoutes(app: FastifyInstance, svc: Services) {
  /** Recent notable events of a level, newest first: publish, plays, records, listings, sales. */
  app.get("/levels/:id/activity", async (req, reply) => {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return badRequest(reply, "invalid id");
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 10) || 10, 1), 50);
    const items = svc.db
      .prepare(
        `SELECT kind, actor, tx_hash AS hash, block_number AS block, created_at AS at
         FROM activity WHERE level_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(p.data.id, limit);
    return { levelId: p.data.id, items };
  });

  /** FORGE earned by the level's owner, total and per UTC day. */
  app.get("/levels/:id/earnings", async (req, reply) => {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return badRequest(reply, "invalid id");
    return { levelId: p.data.id, ...ownerEarnings(svc, p.data.id) };
  });

  /** Fixed-price listings of the NFT market (active levels with a listing price), newest listing first. */
  app.get("/market/listings", async () => {
    const items = svc.db
      .prepare(
        `SELECT x.*, (SELECT MAX(a.created_at) FROM activity a WHERE a.level_id = x.id AND a.kind = 'Listed') AS listed_at
         FROM (${LEVEL_SELECT} WHERE l.active = 1 AND l.listing_price IS NOT NULL AND l.listing_price != '0') x
         ORDER BY listed_at DESC, x.id DESC LIMIT 100`,
      )
      .all();
    return { items };
  });

  /** Active English auctions, newest ending first; optional levelId filters to one level. */
  app.get("/auctions", async (req) => {
    const levelId = Number((req.query as { levelId?: string }).levelId);
    const items = Number.isInteger(levelId) && levelId > 0
      ? svc.db.prepare("SELECT id AS levelId, auction_seller AS seller, auction_price AS reservePrice, auction_bid AS highestBid, auction_bidder AS highestBidder, auction_end AS endTime FROM levels WHERE id = ? AND auction_end IS NOT NULL").all(levelId)
      : svc.db.prepare("SELECT id AS levelId, auction_seller AS seller, auction_price AS reservePrice, auction_bid AS highestBid, auction_bidder AS highestBidder, auction_end AS endTime FROM levels WHERE auction_end IS NOT NULL ORDER BY auction_end ASC LIMIT 100").all();
    return { items };
  });

  /** A player's stats, created and owned levels, and their latest clears. */
  app.get("/profiles/:address", async (req, reply) => {
    const a = addressSchema.safeParse((req.params as { address: string }).address);
    if (!a.success) return badRequest(reply, "invalid address");
    const address = a.data.toLowerCase();

    const totals = svc.db.prepare("SELECT COUNT(*) AS plays, COALESCE(SUM(cleared), 0) AS clears FROM runs WHERE player = ?").get(address) as { plays: number; clears: number };
    // Best leaderboard position over all levels (rank by best settled time among the players who cleared it).
    const best = svc.db
      .prepare(
        `SELECT MIN(rk) AS rank FROM (
           SELECT player, RANK() OVER (PARTITION BY level_id ORDER BY best) AS rk FROM (
             SELECT level_id, player, MIN(time_ms) AS best FROM runs WHERE cleared = 1 GROUP BY level_id, player))
         WHERE player = ?`,
      )
      .get(address) as { rank: number | null };
    const created = svc.db.prepare(`${LEVEL_SELECT} WHERE l.creator = ? ORDER BY l.id DESC LIMIT 50`).all(address);
    const owned = svc.db.prepare(`${LEVEL_SELECT} WHERE l.owner = ? ORDER BY l.id DESC LIMIT 50`).all(address);
    const recent = svc.db
      .prepare(
        `SELECT r.level_id AS levelId, r.time_ms AS timeMs, r.reward AS reward, r.tx_hash AS hash,
                (SELECT MAX(a.created_at) FROM activity a WHERE a.tx_hash = r.tx_hash AND a.level_id = r.level_id) AS at
         FROM runs r WHERE r.player = ? AND r.cleared = 1 ORDER BY r.id DESC LIMIT 5`,
      )
      .all(address) as { levelId: number; timeMs: number; reward: string | null; hash: string; at: number | null }[];
    const levelOf = svc.db.prepare(`${LEVEL_SELECT} WHERE l.id = ?`);
    return {
      address,
      plays: totals.plays,
      clears: totals.clears,
      bestRank: best.rank ?? null,
      created,
      owned,
      recentClears: recent.flatMap((r) => {
        const level = levelOf.get(r.levelId);
        return level ? [{ level, timeMs: r.timeMs, reward: r.reward ?? "0", hash: r.hash, at: r.at }] : [];
      }),
    };
  });
}
