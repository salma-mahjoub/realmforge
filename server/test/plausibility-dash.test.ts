import { describe, expect, it } from "vitest";
import { MOVEMENT } from "@realmforge/game-core";
import { checkStep } from "../src/validation/plausibility.js";
import { PHYSICS } from "../src/validation/constants.js";

const dashPerTick = MOVEMENT.dashSpeed / MOVEMENT.referenceTile;

describe("plausibility: dash power-up", () => {
  it("derives the dash bound from game-core, not a copy", () => {
    expect(PHYSICS.dashTilesPerTick).toBe(dashPerTick);
  });

  it("accepts a full-speed dash burst over several ticks", () => {
    const ticks = 10;
    expect(checkStep({ f: 0, x: 5, y: 10 }, { f: ticks, x: 5 + dashPerTick * ticks, y: 10 })).toBeNull();
  });

  it("still rejects motion clearly faster than a dash", () => {
    const ticks = 10;
    const issue = checkStep({ f: 0, x: 5, y: 10 }, { f: ticks, x: 5 + dashPerTick * 2 * ticks, y: 10 });
    expect(issue?.code).toBe("speed");
  });
});
