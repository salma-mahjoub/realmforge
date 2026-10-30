/**
 * Physics bounds used for plausibility checks (SPEC §3.6).
 *
 * Values mirror game-core/src/constants.ts MOVEMENT (reference px per 60 Hz frame,
 * 16 px reference tile) converted to *tiles per tick* so they are independent of the
 * 18/21 px render tile. They are copied, not imported, until @realmforge/game-core
 * is published as a dependency.
 * TODO(game-core): import MOVEMENT/FIXED_HZ from @realmforge/game-core instead.
 */
const REFERENCE_TILE = 16;
const RUN_MAX = 2.5; // ref px / frame
const SPRING_VELOCITY = 7; // ref px / frame (strongest vertical launch)
const MAX_FALL = 4; // ref px / frame

export const PHYSICS = {
  tickHz: 60,
  /** Fastest horizontal speed, tiles per tick. */
  maxRunTilesPerTick: RUN_MAX / REFERENCE_TILE,
  /** Fastest vertical speed (spring launch / falling), tiles per tick. */
  maxVerticalTilesPerTick: Math.max(SPRING_VELOCITY, MAX_FALL) / REFERENCE_TILE,
  /** Head-room for dash power-ups, conveyors, moving platforms, float error. */
  speedTolerance: 1.75,
  /** Divide theoretical min time by this (dash, springs) to get a safe lower bound. */
  minTimeSafetyFactor: 1.6,
  /** Positions within this many tiles of a door/pipe may jump (teleport). */
  teleportRadiusTiles: 2,
  /** Player must be within this many tiles of the goal when finishing. */
  goalRadiusTiles: 3,
  /** Allowed mismatch between declared timeMs and trace length. */
  timeSlackMs: 250,
} as const;
