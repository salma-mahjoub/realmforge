/**
 * Physics bounds used for plausibility checks (SPEC §3.6).
 *
 * Derived from @realmforge/game-core (`MOVEMENT`, `FIXED_HZ` — reference px per 60 Hz frame,
 * 16 px reference tile) converted to *tiles per tick* so they are independent of the render tile.
 * game-core is a local `file:../game-core` dependency (build it first: `npm run build` in game-core/).
 */
import { FIXED_HZ, MOVEMENT } from "@realmforge/game-core";

const REFERENCE_TILE = MOVEMENT.referenceTile;

export const PHYSICS = {
  tickHz: FIXED_HZ,
  /** Fastest horizontal speed, tiles per tick. */
  maxRunTilesPerTick: MOVEMENT.runMax / REFERENCE_TILE,
  /** Fastest vertical speed (spring launch / falling), tiles per tick. */
  maxVerticalTilesPerTick: Math.max(MOVEMENT.springVelocity, MOVEMENT.maxFallSpeed, -MOVEMENT.springVelocity) / REFERENCE_TILE,
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
