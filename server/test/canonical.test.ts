import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { canonicalize, layoutHash } from "../src/level/canonical.js";
import { levelSchema } from "../src/level/schema.js";
import { makeLevel } from "./helpers.js";

function shuffleKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shuffleKeys);
  if (v && typeof v === "object") {
    const entries = Object.entries(v).reverse();
    return Object.fromEntries(entries.map(([k, x]) => [k, shuffleKeys(x)]));
  }
  return v;
}

describe("layoutHash / canonical JSON", () => {
  it("is deterministic regardless of key order", () => {
    const a = makeLevel();
    const b = shuffleKeys(a);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(layoutHash(a)).toBe(layoutHash(b));
  });

  it("is keccak256 of the canonical UTF-8 bytes", () => {
    expect(canonicalize({ b: 1, a: [true, null, "é"] })).toBe('{"a":[true,null,"é"],"b":1}');
    expect(layoutHash({ b: 1, a: 2 })).toBe(keccak256(toHex('{"a":2,"b":1}')));
  });

  it("changes when content changes (array order matters)", () => {
    const a = makeLevel();
    const b = makeLevel();
    b.entities.reverse();
    expect(layoutHash(a)).not.toBe(layoutHash(b));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow();
  });

  it("level schema accepts the SPEC example shape and rejects out-of-bounds goals", () => {
    expect(levelSchema.safeParse(makeLevel()).success).toBe(true);
    const bad = { ...makeLevel(), goal: { x: 999, y: 1 } };
    expect(levelSchema.safeParse(bad).success).toBe(false);
  });
});
