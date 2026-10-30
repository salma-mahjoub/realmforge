import { describe, expect, it } from "vitest";
import { analyzeLevel } from "../src/level/analysis.js";
import { levelSchema } from "../src/level/schema.js";
import { checkRunPlausibility } from "../src/validation/index.js";
import { runSubmissionSchema } from "../src/validation/types.js";
import { makeLevel, makeRun } from "./helpers.js";

const level = levelSchema.parse(makeLevel());
const analysis = analyzeLevel(level);
const run = (o?: Parameters<typeof makeRun>[0]) => runSubmissionSchema.parse(makeRun(o));

describe("run plausibility (SPEC §3.6)", () => {
  it("computes a positive min time and max coins at publish", () => {
    expect(analysis.minTimeMs).toBeGreaterThan(1000);
    expect(analysis.maxCoins).toBe(6);
    expect(analysis.checkpoints.map((c) => c.id)).toEqual([10]);
  });

  it("accepts a plausible run", () => {
    const r = checkRunPlausibility(run(), analysis);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("rejects speed hacks", () => {
    const r = checkRunPlausibility(run({ speed: 0.6 }), analysis);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "speed")).toBe(true);
  });

  it("rejects a teleport straight to the goal", () => {
    const r0 = run();
    const cheat = { ...r0, trace: [r0.trace[0], { f: 30, x: 40, y: 24 }], timeMs: 500 };
    const r = checkRunPlausibility(cheat, analysis);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["speed", "min_time"]));
  });

  it("rejects missing / out-of-order checkpoints and too many coins", () => {
    const r = checkRunPlausibility({ ...run({ coins: 99 }), checkpoints: [] }, analysis);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["checkpoint_order", "coins"]));
  });

  it("rejects a declared time that does not match the trace", () => {
    const r = checkRunPlausibility({ ...run(), timeMs: 1_000_000 }, analysis);
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["time_mismatch", "time_limit"]));
  });
});
