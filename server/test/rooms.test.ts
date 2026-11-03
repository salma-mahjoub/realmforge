import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "@colyseus/core";
import { Client } from "colyseus.js";
import { verifyTypedData } from "viem";
import { createGameServer } from "../src/game.js";
import { forgeCoinDomain, raceResultTypes } from "../src/eip712.js";
import type { Services } from "../src/services.js";
import { FORGE_COIN, PLAYER, TEST_SIGNER, testServices } from "./helpers.js";

const P2 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
let svc: Services;
let game: Server;
const PORT = 25_000 + Math.floor(Math.random() * 1000);

beforeAll(async () => {
  svc = testServices();
  game = createGameServer({ signer: svc.signer, levels: svc.levels });
  await game.listen(PORT, "127.0.0.1");
});
afterAll(async () => {
  await game.gracefullyShutdown(false);
  svc.db.close();
});

describe("RaceRoom (Colyseus)", () => {
  it("runs a 2-player race and broadcasts a signed RaceResult", async () => {
    const client = new Client(`ws://127.0.0.1:${PORT}`);
    const a = await client.create("race", { address: PLAYER, timeLimitSec: 30 });
    expect(a.roomId).toMatch(/^[A-Z2-9]{4}$/); // short and uppercase: what a player can type
    const b = await client.joinById(a.roomId, { address: P2 });

    await expect(client.joinById(a.roomId, { address: "not-an-address" })).rejects.toBeTruthy();

    const result = new Promise<any>((resolve) => a.onMessage("result", resolve));
    b.onMessage("result", () => {});
    const started = new Promise<void>((resolve) => a.onMessage("start", () => resolve()));
    for (const r of [a, b]) {
      r.onMessage("*", () => {});
      r.send("ready");
    }
    await started;
    b.send("finish");
    await new Promise((r) => setTimeout(r, 100));
    a.send("finish");

    const res = await result;
    expect(res.kind).toBe("race");
    expect(res.result.ranking).toEqual([P2, PLAYER]);
    const ok = await verifyTypedData({
      address: TEST_SIGNER,
      domain: forgeCoinDomain(31337, FORGE_COIN),
      types: raceResultTypes,
      primaryType: "RaceResult",
      message: { roomId: res.result.roomId, ranking: res.result.ranking, deadline: BigInt(res.result.deadline) },
      signature: res.signature,
    });
    expect(ok).toBe(true);
    await a.leave();
    await b.leave();
  });

  it("ends the race when the last racer gives up and ranks the finisher first", async () => {
    const client = new Client(`ws://127.0.0.1:${PORT}`);
    const a = await client.create("race", { address: PLAYER, timeLimitSec: 30 });
    const b = await client.joinById(a.roomId, { address: P2 });
    const result = new Promise<any>((resolve) => a.onMessage("result", resolve));
    b.onMessage("result", () => {});
    const started = new Promise<void>((resolve) => a.onMessage("start", () => resolve()));
    for (const r of [a, b]) {
      r.onMessage("*", () => {});
      r.send("ready");
    }
    await started;
    a.send("finish");
    await new Promise((r) => setTimeout(r, 100));
    b.send("giveup"); // the only racer left abandons: the race must not wait for the 30 s limit
    const res = await result;
    expect(res.result.ranking).toEqual([PLAYER, P2]);
    await a.leave();
    await b.leave();
  });

  it("settles with a full ranking when nobody finishes (everyone gives up)", async () => {
    const client = new Client(`ws://127.0.0.1:${PORT}`);
    const a = await client.create("race", { address: PLAYER, timeLimitSec: 30 });
    const b = await client.joinById(a.roomId, { address: P2 });
    const result = new Promise<any>((resolve) => a.onMessage("result", resolve));
    b.onMessage("result", () => {});
    const started = new Promise<void>((resolve) => a.onMessage("start", () => resolve()));
    for (const r of [a, b]) {
      r.onMessage("*", () => {});
      r.send("ready");
    }
    await started;
    a.send("giveup");
    b.send("giveup");
    const res = await result;
    expect(res.result.ranking).toHaveLength(2);
    expect(new Set(res.result.ranking)).toEqual(new Set([PLAYER, P2]));
    await a.leave();
    await b.leave();
  });

  it("accepts positions again after a respawn restarts the frame counter", async () => {
    const client = new Client(`ws://127.0.0.1:${PORT}`);
    const a = await client.create("race", { address: PLAYER, timeLimitSec: 30 });
    const b = await client.joinById(a.roomId, { address: P2 });
    const started = new Promise<void>((resolve) => a.onMessage("start", () => resolve()));
    for (const r of [a, b]) {
      r.onMessage("*", () => {});
      r.send("ready");
    }
    await started;
    const xOfA = () => (a.state as any).players.get(a.sessionId)?.x as number;
    a.send("pos", { f: 40, x: 5, y: 3 }); // within the 1 s clock slack
    await new Promise((r) => setTimeout(r, 150));
    expect(xOfA()).toBe(5);
    a.send("pos", { f: 3, x: 1, y: 3 }); // frame went back without a respawn: stale, ignored
    await new Promise((r) => setTimeout(r, 150));
    expect(xOfA()).toBe(5);
    a.send("respawn");
    a.send("pos", { f: 3, x: 1, y: 3 });
    await new Promise((r) => setTimeout(r, 150));
    expect(xOfA()).toBe(1);
    await a.leave();
    await b.leave();
  });
});
