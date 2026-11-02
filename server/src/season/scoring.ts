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

const rank = (m: Map<string, { score: number; reachedBlock: number }>): Scored[] =>
  [...m]
    .filter(([, v]) => v.score > 0)
    .map(([address, v]) => ({ address: address as Address, ...v }))
    .sort((a, b) => b.score - a.score || a.reachedBlock - b.reachedBlock || a.address.localeCompare(b.address))
    .slice(0, MAX_WINNERS);

function add(m: Map<string, { score: number; reachedBlock: number }>, who: string, points: number, block: number) {
  const cur = m.get(who) ?? { score: 0, reachedBlock: 0 };
  m.set(who, { score: cur.score + points, reachedBlock: Math.max(cur.reachedBlock, block) });
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

export function computeSeason(db: Db): SeasonRanking {
  const { season, afterBlock } = currentSeason(db);
  const runs = db
    .prepare(
      `SELECT r.level_id, r.player, r.time_ms, r.cleared, r.block_number, l.creator, l.owner
       FROM runs r JOIN levels l ON l.id = r.level_id
       WHERE r.block_number > ? AND r.fee_paid IS NOT NULL ORDER BY r.block_number, r.id`,
    )
    .all(afterBlock) as unknown as RunRow[];

  const players = new Map<string, { score: number; reachedBlock: number }>();
  const creators = new Map<string, { score: number; reachedBlock: number }>();
  const clearedBy = new Set<string>(); // `${level}:${player}`
  const payers = new Set<string>(); // `${creator}:${player}`
  const best = new Map<number, RunRow>(); // level -> best cleared run

  for (const r of runs) {
    if (r.player === r.creator || r.player === r.owner) continue; // self-play earns nothing
    if (!payers.has(`${r.creator}:${r.player}`)) {
      payers.add(`${r.creator}:${r.player}`);
      add(creators, r.creator, 1, r.block_number);
    }
    if (!r.cleared) continue;
    if (!clearedBy.has(`${r.level_id}:${r.player}`)) {
      clearedBy.add(`${r.level_id}:${r.player}`);
      add(players, r.player, 1, r.block_number);
    }
    const cur = best.get(r.level_id);
    if (!cur || r.time_ms < cur.time_ms) best.set(r.level_id, r); // strict <: the earlier run keeps a tie
  }
  for (const r of best.values()) add(players, r.player, 2, r.block_number);

  const p = rank(players);
  const c = rank(creators);
  const playersHalf = c.length === 0 ? BPS : PLAYERS_SIDE_BPS;
  const creatorsHalf = p.length === 0 ? BPS : BPS - PLAYERS_SIDE_BPS;
  const shares = [...(p.length ? allocate(p.map((x) => x.score), playersHalf) : []), ...(c.length ? allocate(c.map((x) => x.score), creatorsHalf) : [])];
  return { season, afterBlock, players: p, creators: c, shares };
}
