import { describe, expect, it } from "vitest";
import { completeRanking } from "../src/rooms/ranking.js";

const p = (address: string, checkpoint: number, x: number, disqualified = false) => ({ address, checkpoint, x, y: 0, disqualified });

describe("completeRanking", () => {
  const goal = { x: 100, y: 0 };

  it("keeps finishers first, in finish order", () => {
    const players = [p("A", 2, 90), p("B", 2, 100), p("C", 0, 5)];
    expect(completeRanking(["B", "A"], players, goal)).toEqual(["B", "A", "C"]);
  });

  it("ranks a single finisher followed by the rest, so settleRace gets two players", () => {
    expect(completeRanking(["A"], [p("A", 1, 100), p("B", 0, 10)], goal)).toEqual(["A", "B"]);
  });

  it("ranks non-finishers by checkpoint, then by distance to the goal", () => {
    const players = [p("A", 0, 99), p("B", 2, 40), p("C", 2, 70), p("D", 1, 95)];
    expect(completeRanking([], players, goal)).toEqual(["C", "B", "D", "A"]);
  });

  it("puts disqualified players last whatever their progress", () => {
    expect(completeRanking([], [p("A", 3, 99, true), p("B", 0, 1)], goal)).toEqual(["B", "A"]);
  });

  it("falls back to the furthest x without a goal and is stable on ties", () => {
    expect(completeRanking([], [p("B", 0, 10), p("A", 0, 10), p("C", 0, 30)])).toEqual(["C", "A", "B"]);
  });
});
