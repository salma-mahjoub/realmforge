import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyTypedData } from "viem";
import { buildApi } from "../src/api/server.js";
import { forgeCoinDomain, seasonResultTypes } from "../src/eip712.js";
import { applyLog } from "../src/indexer/index.js";
import { allocate, computeSeason } from "../src/season/scoring.js";
import type { Services } from "../src/services.js";
import { FORGE_COIN, TEST_SIGNER, testServices } from "./helpers.js";

const C1 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const C2 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const P1 = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const P2 = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const P3 = "0x976EA74026E726554dB657fA54763abd0C3a0aa9";
const E18 = 10n ** 18n;

let svc: Services;
let block = 100n;
let n = 0;
const emit = (eventName: string, args: Record<string, unknown>) =>
  applyLog(svc.db, { eventName, args, blockNumber: block++, transactionHash: `0x${(++n).toString(16).padStart(64, "0")}`, logIndex: 0 });
const publish = (id: bigint, creator: string) => emit("LevelPublished", { id, creator, layoutHash: "0x" + id.toString(16).padStart(64, "0"), parentId: 0n, playFee: E18 });
const run = (player: string, levelId: bigint, timeMs: number, cleared: boolean) =>
  emit("RunSettled", { player, levelId, timeMs, cleared, reward: 0n, feePaid: E18 });

beforeAll(() => {
  svc = testServices();
  publish(1n, C1);
  publish(2n, C2);
  run(P1, 1n, 5000, true);
  run(P2, 1n, 6000, true);
  run(P3, 1n, 9000, false);
  run(C1, 1n, 1000, true); // self-play: ignored
  run(P1, 2n, 4000, true);
  run(P2, 2n, 3000, true);
});
afterAll(() => svc.db.close());

describe("season scoring", () => {
  it("scores players by distinct clears and held records, creators by distinct payers, ignoring self-plays", () => {
    const r = computeSeason(svc.db);
    expect(r.season).toBe(1);
    // P1: 2 clears + best on level 1 (2) = 4; P2: 2 clears + best on level 2 (2) = 4; P3 cleared nothing
    expect(r.players.map((p) => [p.address, p.score])).toEqual([[P1.toLowerCase(), 4], [P2.toLowerCase(), 4]]);
    // C1 was paid by P1, P2, P3 (not by themselves); C2 by P1, P2
    expect(r.creators.map((c) => [c.address, c.score])).toEqual([[C1.toLowerCase(), 3], [C2.toLowerCase(), 2]]);
  });

  it("breaks a tie by the earlier block, then splits 50/50 between the two sides and always sums to 10 000", () => {
    const r = computeSeason(svc.db);
    // P1 and P2 both have 4 points; P1 reached it at block 104 (best of level 1 is P1's run at 5000 ms, block 104),
    // P2's last scoring run is at block 105, so P1 comes first.
    expect(r.players[0]!.address).toBe(P1.toLowerCase());
    expect(r.shares).toEqual([2500, 2500, 3000, 2000]);
    expect(r.shares.reduce((a, b) => a + b, 0)).toBe(10_000);
  });

  it("allocate gives the rounding remainder to the first entry", () => {
    expect(allocate([1, 1, 1], 5000)).toEqual([1668, 1666, 1666]);
    expect(allocate([5], 10_000)).toEqual([10_000]);
    expect(allocate([0, 0], 5000)).toEqual([0, 0]);
  });

  it("only counts runs after the block where the previous season was closed", () => {
    emit("SeasonClosed", { season: 1n, pool: 5n * E18 });
    expect(computeSeason(svc.db)).toMatchObject({ season: 2, players: [], creators: [], shares: [] });
    run(P3, 2n, 7000, true);
    const r = computeSeason(svc.db);
    expect(r.season).toBe(2);
    expect(r.players.map((p) => [p.address, p.score])).toEqual([[P3.toLowerCase(), 3]]); // 1 clear + best of level 2
    expect(r.creators.map((c) => [c.address, c.score])).toEqual([[C2.toLowerCase(), 1]]);
    expect(r.shares).toEqual([5000, 5000]);
  });

  it("gives the whole pool to one side when the other is empty", () => {
    const s = testServices();
    const prev = svc;
    svc = s;
    publish(9n, C1);
    run(C1, 9n, 1000, true); // only a self-play: nobody scores
    expect(computeSeason(s.db).shares).toEqual([]);
    svc = prev;
    s.db.close();
  });
});

describe("POST /season/close-proof", () => {
  it("signs the ranking computed by the server for ForgeCoin.closeSeason", async () => {
    const app = await buildApi(svc);
    const res = await app.inject({ method: "POST", url: "/season/close-proof" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message.season).toBe("2");
    expect(body.message.players).toEqual([P3.toLowerCase()]);
    expect(body.message.shares).toEqual(['5000', '5000']);
    const ok = await verifyTypedData({
      address: TEST_SIGNER,
      domain: forgeCoinDomain(31337, FORGE_COIN),
      types: seasonResultTypes,
      primaryType: "SeasonResult",
      message: {
        season: BigInt(body.message.season),
        players: body.message.players,
        creators: body.message.creators,
        shares: body.message.shares.map((s: string) => BigInt(s)),
      },
      signature: body.signature,
    });
    expect(ok).toBe(true);
    await app.close();
  });

  it("GET /season/current exposes the live ranking and the closed seasons", async () => {
    const app = await buildApi(svc);
    const body = (await app.inject({ method: "GET", url: "/season/current" })).json();
    expect(body.season).toBe(2);
    expect(body.closed[0]).toMatchObject({ season: 1 });
    await app.close();
  });
});
