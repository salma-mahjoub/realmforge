import type { Level, LevelEntity } from "./schema.js";
import { PHYSICS } from "../validation/constants.js";

export interface LevelAnalysis {
  /** Ordered checkpoint entities (by props.order, then x). */
  checkpoints: { id: number; x: number; y: number }[];
  /** Teleport endpoints (door/pipe) in tile coords — speed checks are relaxed near them. */
  teleports: { x: number; y: number }[];
  /** Max collectible coin value. */
  maxCoins: number;
  /** Lower bound on clear time, ms (computed at publish, SPEC §3.6). */
  minTimeMs: number;
  tile: number;
  goal: { x: number; y: number };
  spawn: { x: number; y: number };
  timeLimitMs: number;
}

/** Coin values granted by game-core's element runtime (coin 1, big_coin 10, question block reward). */
const COIN_VALUES: Record<string, number> = { coin: 1, big_coin: 10 };
const QUESTION_REWARD: Record<string, number> = { coin: 1, big_coin: 10 };
/** Terrain byte of `question_block` in layers.terrain (web/src/game/level/types.ts TERRAIN_IDS). */
const TERRAIN_QUESTION_BLOCK = 3;

/** Count cells with value `v` in the RLE terrain layer (`value*count` runs, comma-separated). */
function countTerrain(rle: string, v: number): number {
  let n = 0;
  for (const run of rle ? rle.split(",") : []) {
    const [vs, ns] = run.split("*");
    if (Number(vs) === v) n += ns === undefined ? 1 : Number(ns) || 0;
  }
  return n;
}

/**
 * Static analysis of a level used by plausibility checks.
 *
 * minTimeMs heuristic: horizontal distance spawn->goal at the controller's max
 * horizontal speed (dash power-ups and springs could beat this, so a safety factor
 * is applied). Teleports (doors/pipes) can shortcut distance, so levels with
 * teleports use a lower bound of 0 horizontal distance through them.
 * Speeds come from game-core MOVEMENT (see validation/constants.ts).
 */
export function analyzeLevel(level: Level): LevelAnalysis {
  const tile = level.size.tile;
  const checkpoints = level.entities
    .filter((e) => e.type === "checkpoint")
    .map((e) => ({ e, order: typeof e.props?.order === "number" ? (e.props.order as number) : e.x }))
    .sort((a, b) => a.order - b.order || a.e.x - b.e.x || a.e.id - b.e.id)
    .map(({ e }) => ({ id: e.id, x: e.x, y: e.y }));
  const teleports = level.entities.filter((e: LevelEntity) => e.type === "door" || e.type === "pipe" || e.type === "locked_door").map((e) => ({ x: e.x, y: e.y }));
  const maxCoins =
    level.entities.reduce(
      (acc, e) =>
        acc +
        (COIN_VALUES[e.type] ?? 0) +
        (e.type === "question_block" ? (QUESTION_REWARD[String(e.props?.reward ?? "coin")] ?? 0) : 0),
      0,
    ) + countTerrain(level.layers.terrain ?? "", TERRAIN_QUESTION_BLOCK);
  const dxTiles = teleports.length > 0 ? 0 : Math.abs(level.goal.x - level.spawn.x);
  const maxTilesPerMs = (PHYSICS.maxRunTilesPerTick * PHYSICS.tickHz) / 1000;
  const minTimeMs = Math.floor(dxTiles / maxTilesPerMs / PHYSICS.minTimeSafetyFactor);
  return {
    checkpoints,
    teleports,
    maxCoins,
    minTimeMs,
    tile,
    goal: level.goal,
    spawn: level.spawn,
    timeLimitMs: level.meta.timeLimit * 1000,
  };
}
