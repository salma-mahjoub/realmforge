import { analyzeLevel, type LevelAnalysis } from "../level/analysis.js";
import type { Level } from "../level/schema.js";
import { checkRunPlausibility } from "./plausibility.js";
import { NoopReplayVerifier, type ReplayVerifier } from "./replay.js";
import type { RunSubmission, ValidationResult } from "./types.js";

export * from "./types.js";
export * from "./plausibility.js";
export * from "./replay.js";
export { PHYSICS } from "./constants.js";

export class RunValidator {
  constructor(private readonly replay: ReplayVerifier = new NoopReplayVerifier()) {}

  async validate(level: Level, run: RunSubmission, analysis: LevelAnalysis = analyzeLevel(level)): Promise<ValidationResult> {
    const plausibility = checkRunPlausibility(run, analysis);
    if (!plausibility.ok) return plausibility;
    if (run.inputLog) {
      const replay = await this.replay.verify(level, run);
      if (!replay.ok) return replay;
    }
    return { ok: true, issues: [] };
  }
}
