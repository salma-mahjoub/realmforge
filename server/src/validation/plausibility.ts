import type { LevelAnalysis } from "../level/analysis.js";
import { PHYSICS } from "./constants.js";
import type { RunSubmission, ValidationIssue, ValidationResult, TraceSample } from "./types.js";

const FRAME_MS = 1000 / PHYSICS.tickHz;

function nearAny(p: { x: number; y: number }, pts: { x: number; y: number }[], r: number): boolean {
  return pts.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= r);
}

/**
 * Per-tick speed check between two samples. Returns an issue or null.
 * Exported so rooms can reuse it for live position updates.
 */
export function checkStep(
  a: TraceSample,
  b: TraceSample,
  teleports: { x: number; y: number }[] = [],
): ValidationIssue | null {
  const ticks = b.f - a.f;
  if (ticks <= 0) return { code: "trace_order", message: `frames not increasing at ${b.f}`, frame: b.f };
  const maxDx = PHYSICS.maxRunTilesPerTick * PHYSICS.speedTolerance * ticks + 0.05;
  const maxDy = PHYSICS.maxVerticalTilesPerTick * PHYSICS.speedTolerance * ticks + 0.05;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx <= maxDx && dy <= maxDy) return null;
  // Teleport (door/pipe pairs) or respawn-at-checkpoint jumps are allowed when the
  // jump starts next to a teleporter. Respawns are handled by the caller via `respawnPoints`.
  if (nearAny(a, teleports, PHYSICS.teleportRadiusTiles) && nearAny(b, teleports, PHYSICS.teleportRadiusTiles)) return null;
  return {
    code: "speed",
    message: `moved dx=${dx.toFixed(2)} dy=${dy.toFixed(2)} tiles in ${ticks} ticks (max ${maxDx.toFixed(2)}/${maxDy.toFixed(2)})`,
    frame: b.f,
  };
}

/**
 * Plausibility checks from SPEC §3.6: max speed per tick, checkpoint order, minimum
 * possible time per level, plus consistency checks (time vs trace length, start at
 * spawn, end at goal when cleared, coins <= coins in level).
 */
export function checkRunPlausibility(run: RunSubmission, level: LevelAnalysis): ValidationResult {
  const issues: ValidationIssue[] = [];
  const { trace } = run;
  const respawns = [level.spawn, ...level.checkpoints];

  // Start position
  if (Math.hypot(trace[0].x - level.spawn.x, trace[0].y - level.spawn.y) > 2) {
    issues.push({ code: "spawn", message: "trace does not start at spawn", frame: trace[0].f });
  }

  // Speed per tick
  for (let i = 1; i < trace.length; i++) {
    const issue = checkStep(trace[i - 1], trace[i], level.teleports);
    if (!issue) continue;
    // Death -> respawn at spawn/checkpoint is a legal discontinuity.
    if (issue.code === "speed" && nearAny(trace[i], respawns, 1.5)) continue;
    issues.push(issue);
    if (issues.length > 20) break;
  }

  // Time consistency
  const lastFrame = trace[trace.length - 1].f - trace[0].f;
  const traceMs = lastFrame * FRAME_MS;
  if (Math.abs(traceMs - run.timeMs) > PHYSICS.timeSlackMs) {
    issues.push({ code: "time_mismatch", message: `timeMs=${run.timeMs} but trace spans ${Math.round(traceMs)} ms` });
  }
  if (run.timeMs > level.timeLimitMs) {
    issues.push({ code: "time_limit", message: `timeMs ${run.timeMs} exceeds limit ${level.timeLimitMs}` });
  }

  // Checkpoint order: hits must follow the level's checkpoint order with increasing frames.
  const orderIndex = new Map(level.checkpoints.map((c, i) => [c.id, i]));
  let lastIdx = -1;
  let lastFrameSeen = -1;
  for (const hit of run.checkpoints) {
    const idx = orderIndex.get(hit.id);
    if (idx === undefined) {
      issues.push({ code: "checkpoint_unknown", message: `checkpoint ${hit.id} not in level`, frame: hit.f });
      continue;
    }
    if (idx <= lastIdx || hit.f < lastFrameSeen) {
      issues.push({ code: "checkpoint_order", message: `checkpoint ${hit.id} reached out of order`, frame: hit.f });
    }
    lastIdx = Math.max(lastIdx, idx);
    lastFrameSeen = Math.max(lastFrameSeen, hit.f);
  }

  if (run.cleared) {
    // All checkpoints must be passed to clear (shared rule with rooms).
    if (level.checkpoints.length > 0 && new Set(run.checkpoints.map((c) => c.id)).size < level.checkpoints.length) {
      issues.push({ code: "checkpoint_order", message: "not all checkpoints reached before goal" });
    }
    const last = trace[trace.length - 1];
    if (Math.hypot(last.x - level.goal.x, last.y - level.goal.y) > PHYSICS.goalRadiusTiles) {
      issues.push({ code: "goal", message: "trace does not end at the goal", frame: last.f });
    }
    if (run.timeMs < level.minTimeMs) {
      issues.push({ code: "min_time", message: `timeMs ${run.timeMs} below level minimum ${level.minTimeMs}` });
    }
  }

  if (run.coins > level.maxCoins) {
    issues.push({ code: "coins", message: `coins ${run.coins} > max ${level.maxCoins}` });
  }

  return { ok: issues.length === 0, issues };
}
