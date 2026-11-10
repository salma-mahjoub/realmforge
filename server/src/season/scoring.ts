import type { Address } from "viem";
import type { Db } from "../db.js";

/**
 * Season ranking (docs/SEASONS.md). Computed from the indexed events only, so anyone can recompute it from the
 * public chain and compare it with what the server signed. Self-plays (owner or creator playing their own level)
 * earn nothing, like they earn no rewards on-chain.
 *
 *  players : +1 per distinct level cleared, +2 per level where they hold the best settled time of the season
 *  creators: +1 per distinct paying player on any of their levels
 *  pool    : 50% players / 50% creators (all to one side when the other is empty), top 10 each, proportional
 *            to the score in basis points; the rounding remainder goes to the first of each side.
 */
export const MAX_WINNERS = 10;
const BPS = 10_000;
const PLAYERS_SIDE_BPS = 5_000;

export interface Scored {
  address: Address;
  score: number;
  /** Block at which the final score was reached (earlier wins a tie). */
  reachedBlock: number;
}

/** One row of the full standings (GET /season/standings): every scorer, not only the top 10, with the breakdown. */
export interface Standing extends Scored {
  rank: number;
  /** In the top MAX_WINNERS: paid by closeSeason. */
  winner: boolean;
  /** Basis points of the pool this address would receive if the season closed now (0 when not a winner). */
  shareBps: number;
  /** players: distinct levels cleared · creators: distinct paying players */
  primary: number;
  /** players: levels where they hold the season's best time · creators: distinct levels that were paid for */
  secondary: number;
}

export interface SeasonStandings {
  season: number;
  afterBlock: number;
  players: Standing[];
  creators: Standing[];
  totals: { runs: number; clears: number; activePlayers: number; activeLevels: number };
}

export interface SeasonRanking {
  season: number;
  /** Runs counted are strictly after this block (the block where the previous season was closed). */
  afterBlock: number;
  players: Scored[];
  creators: Scored[];
  /** Basis points, one per winner: players first, then creators (the `shares` of closeSeason). Sums to 10 000, or is empty. */
  shares: number[];
}

interface RunRow {
  level_id: number;
  player: string;
  time_ms: number;
  cleared: number;
  block_number: number;
  creator: string;
  owner: string;
}

/** `half` basis points shared proportionally to the scores; the remainder is added to the first entry. */
export function allocate(scores: number[], half: number): number[] {
  const total = scores.reduce((a, b) => a + b, 0);
  if (total === 0) return scores.map(() => 0);
  const out = scores.map((s) => Math.floor((half * s) / total));
  out[0]! += half - out.reduce((a, b) => a + b, 0);
  return out;
}

export function currentSeason(db: Db): { season: number; afterBlock: number } {
  const row = db.prepare("SELECT season, block_number AS block FROM seasons ORDER BY season DESC LIMIT 1").get() as { season: number; block: number } | undefined;
  return { season: (row?.season ?? 0) + 1, afterBlock: row?.block ?? 0 };
}

type Acc = Map<string, { score: number; reachedBlock: number; primary: number; secondary: number }>;

function add(m: Acc, who: string, points: number, block: number, field?: "primary" | "secondary") {
  const cur = m.get(who) ?? { score: 0, reachedBlock: 0, primary: 0, secondary: 0 };
  cur.score += points;
  cur.reachedBlock = Math.max(cur.reachedBlock, block);
  if (field) cur[field] += 1;
  m.set(who, cur);
}

const order = (m: Acc) =>
  [...m]
    .filter(([, v]) => v.score > 0)
    .map(([address, v]) => ({ address: address as Address, ...v }))
    .sort((a, b) => b.score - a.score || a.reachedBlock - b.reachedBlock || a.address.localeCompare(b.address));

/** Every scorer of the running season, ranked, with the share each winner would get if the season closed now. */
export function computeStandings(db: Db): SeasonStandings {
  const { season, afterBlock } = currentSeason(db);
  const runs = db
    .prepare(
      `SELECT r.level_id, r.player, r.time_ms, r.cleared, r.block_number, l.creator, l.owner
       FROM runs r JOIN levels l ON l.id = r.level_id
       WHERE r.block_number > ? AND r.fee_paid IS NOT NULL ORDER BY r.block_number, r.id`,
    )
    .all(afterBlock) as unknown as RunRow[];

  const players: Acc = new Map();
  const creators: Acc = new Map();
  const clearedBy = new Set<string>(); // `${level}:${player}`
  const payers = new Set<string>(); // `${creator}:${player}`
  const paidLevels = new Set<number>();
  const best = new Map<number, RunRow>(); // level -> best cleared run
  const active = new Set<string>();
  let counted = 0;
  let clears = 0;

  for (const r of runs) {
    if (r.player === r.creator || r.player === r.owner) continue; // self-play earns nothing
    counted++;
    active.add(r.player);
    if (!paidLevels.has(r.level_id)) {
      paidLevels.add(r.level_id);
      const c = creators.get(r.creator);
      if (c) c.secondary += 1;
      else creators.set(r.creator, { score: 0, reachedBlock: 0, primary: 0, secondary: 1 });
    }
    if (!payers.has(`${r.creator}:${r.player}`)) {
      payers.add(`${r.creator}:${r.player}`);
      add(creators, r.creator, 1, r.block_number, "primary");
    }
    if (!r.cleared) continue;
    clears++;
    if (!clearedBy.has(`${r.level_id}:${r.player}`)) {
      clearedBy.add(`${r.level_id}:${r.player}`);
      add(players, r.player, 1, r.block_number, "primary");
    }
    const cur = best.get(r.level_id);
    if (!cur || r.time_ms < cur.time_ms) best.set(r.level_id, r); // strict <: the earlier run keeps a tie
  }
  for (const r of best.values()) add(players, r.player, 2, r.block_number, "secondary");

  const p = order(players);
  const c = order(creators);
  const np = Math.min(p.length, MAX_WINNERS);
  const nc = Math.min(c.length, MAX_WINNERS);
  const playersHalf = nc === 0 ? BPS : PLAYERS_SIDE_BPS;
  const creatorsHalf = np === 0 ? BPS : BPS - PLAYERS_SIDE_BPS;
  const pShares = np ? allocate(p.slice(0, np).map((x) => x.score), playersHalf) : [];
  const cShares = nc ? allocate(c.slice(0, nc).map((x) => x.score), creatorsHalf) : [];
  const rows = (list: typeof p, shares: number[]): Standing[] =>
    list.map((x, i) => ({ ...x, rank: i + 1, winner: i < MAX_WINNERS, shareBps: shares[i] ?? 0 }));
  return {
    season,
    afterBlock,
    players: rows(p, pShares),
    creators: rows(c, cShares),
    totals: { runs: counted, clears, activePlayers: active.size, activeLevels: paidLevels.size },
  };
}

export interface ClosedSeason {
  season: number;
  /** Pool before the payouts (SeasonClosed.pool), wei as a decimal string. */
  pool: string;
  block: number;
  hash: string;
  closedAt: number;
  /** FORGE each winner received, in closeSeason order (players first, then creators). */
  payouts: { position: number; address: Address; amount: string }[];
}

/** The latest closed seasons (newest first) with what each winner was actually paid on-chain. */
export function closedSeasons(db: Db, opts: { limit?: number; season?: number } = {}): ClosedSeason[] {
  const cols = "SELECT season, pool, block_number AS block, tx_hash AS hash, closed_at AS closedAt FROM seasons";
  const rows = (
    opts.season !== undefined
      ? db.prepare(`${cols} WHERE season = ?`).all(opts.season)
      : db.prepare(`${cols} ORDER BY season DESC LIMIT ?`).all(opts.limit ?? 10)
  ) as unknown as Omit<ClosedSeason, "payouts">[];
  const pay = db.prepare("SELECT position, recipient AS address, amount FROM season_payouts WHERE season = ? ORDER BY position");
  return rows.map((r) => ({ ...r, payouts: pay.all(r.season) as unknown as ClosedSeason["payouts"] }));
}

/** What `closeSeason` would pay now: the top MAX_WINNERS of each side and their shares (signed by /season/close-proof). */
export function computeSeason(db: Db): SeasonRanking {
  const st = computeStandings(db);
  const strip = ({ address, score, reachedBlock }: Standing): Scored => ({ address, score, reachedBlock });
  const p = st.players.filter((x) => x.winner);
  const c = st.creators.filter((x) => x.winner);
  return { season: st.season, afterBlock: st.afterBlock, players: p.map(strip), creators: c.map(strip), shares: [...p, ...c].map((x) => x.shareBps) };
}
