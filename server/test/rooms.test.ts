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
      message: { roomId: res.result.roomId, ranking: res.result.ranking },
      signature: res.signature,
    });
    expect(ok).toBe(true);
    await a.leave();
    await b.leave();
  });
});
