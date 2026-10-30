import { z } from "zod";

/** One sample of the player's position. `f` = fixed-step frame index (60 Hz), x/y in tiles (float). */
export const traceSampleSchema = z.strictObject({
  f: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const checkpointHitSchema = z.strictObject({
  /** Entity id of the checkpoint. */
  id: z.number().int().nonnegative(),
  /** Frame at which it was reached. */
  f: z.number().int().nonnegative(),
});

/**
 * A run submitted by the client at the end of a solo/clear-check play (SPEC §3.6).
 * - `trace`: position samples (any sampling stride; consecutive samples are checked per tick)
 * - `inputLog`: compressed `frame, buttons` bitmask log (base64) for replay re-simulation (stretch)
 */
export const runSubmissionSchema = z.strictObject({
  timeMs: z.number().int().nonnegative().max(2 ** 32 - 1),
  cleared: z.boolean(),
  coins: z.number().int().nonnegative().max(2 ** 16 - 1),
  trace: z.array(traceSampleSchema).min(2).max(200_000),
  checkpoints: z.array(checkpointHitSchema).max(1000).default([]),
  inputLog: z.string().max(2_000_000).optional(),
});

export type RunSubmission = z.infer<typeof runSubmissionSchema>;
export type TraceSample = z.infer<typeof traceSampleSchema>;

export interface ValidationIssue {
  code:
    | "speed"
    | "checkpoint_order"
    | "checkpoint_unknown"
    | "min_time"
    | "time_limit"
    | "time_mismatch"
    | "trace_order"
    | "spawn"
    | "goal"
    | "coins"
    | "replay";
  message: string;
  frame?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
