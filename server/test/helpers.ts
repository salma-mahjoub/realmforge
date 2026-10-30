import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createServices } from "../src/services.js";

/** PUBLIC Hardhat test key #1 — test-only. */
export const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const TEST_SIGNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
export const LEVEL_NFT = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
export const FORGE_COIN = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as const;
export const PLAYER = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;

export function testConfig(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "realmforge-server-"));
  return loadConfig({
    SIGNER_PRIVATE_KEY: TEST_KEY,
    CHAIN_ID: "31337",
    LEVEL_NFT_ADDRESS: LEVEL_NFT,
    FORGE_COIN_ADDRESS: FORGE_COIN,
    DATA_DIR: dir,
    PINATA_JWT: "",
    ...extra,
  });
}

export function testServices(extra: Record<string, string> = {}) {
  return createServices(testConfig(extra));
}

export function makeLevel() {
  return {
    schema: 1,
    meta: { name: "Test Meadow", theme: "grass", timeLimit: 120, music: "grass_01" },
    size: { w: 60, h: 30, tile: 18 },
    layers: { terrain: "60x30:0*1800" },
    entities: [
      { id: 10, type: "checkpoint", x: 20, y: 25 },
      { id: 11, type: "coin", x: 12, y: 22 },
      { id: 12, type: "big_coin", x: 30, y: 20 },
      { id: 13, type: "seesaw", x: 35, y: 26, props: { length: 6, pivot: { x: 3, y: 0 } } },
    ],
    spawn: { x: 2, y: 25 },
    goal: { x: 40, y: 24 },
  };
}

/** A plausible run: walk spawn -> goal at 0.12 tiles/tick, hitting the checkpoint. */
export function makeRun(opts: { speed?: number; cleared?: boolean; coins?: number } = {}) {
  const speed = opts.speed ?? 0.12;
  const trace: { f: number; x: number; y: number }[] = [];
  const from = { x: 2, y: 25 };
  const to = { x: 40, y: 24 };
  const frames = Math.ceil((to.x - from.x) / speed);
  let cpFrame = -1;
  for (let f = 0; f <= frames; f += 2) {
    const t = Math.min(1, f / frames);
    const x = from.x + (to.x - from.x) * t;
    if (cpFrame < 0 && x >= 20) cpFrame = f;
    trace.push({ f, x, y: from.y + (to.y - from.y) * t });
  }
  if (trace[trace.length - 1].f !== frames) trace.push({ f: frames, x: to.x, y: to.y });
  return {
    timeMs: Math.round((frames * 1000) / 60),
    cleared: opts.cleared ?? true,
    coins: opts.coins ?? 3,
    trace,
    checkpoints: [{ id: 10, f: cpFrame }],
    inputLog: "AAAA",
  };
}
