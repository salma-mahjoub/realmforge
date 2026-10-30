import type { Level } from "../level/schema.js";
import type { RunSubmission, ValidationResult } from "./types.js";

/**
 * Deterministic replay re-simulation hook (SPEC §3.6 stretch goal).
 *
 * The client sends a compressed `frame, buttons` input log. A full verifier would
 * decode it, re-run the 60 Hz fixed-step controller headlessly against the level
 * geometry and compare the outcome (cleared, timeMs, coins, final position) with the
 * claim.
 *
 * TODO(game-core): implement with `@realmforge/game-core` (../game-core/src —
 *   `simulateReplay`, `decodeInput`, MOVEMENT). It is written concurrently and is
 *   deliberately NOT imported yet. Limits to explain at the oral exam: Matter.js
 *   dynamic bodies (crates, seesaws, chains) are not bit-exact across JS engines,
 *   so only the kinematic controller + static tiles can be re-simulated exactly.
 */
export interface ReplayVerifier {
  readonly name: string;
  verify(level: Level, run: RunSubmission): Promise<ValidationResult>;
}

/** Default verifier: accepts everything (plausibility checks still apply). */
export class NoopReplayVerifier implements ReplayVerifier {
  readonly name = "noop";
  async verify(): Promise<ValidationResult> {
    return { ok: true, issues: [] };
  }
}
