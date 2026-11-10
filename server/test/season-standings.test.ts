import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeAbiParameters, toFunctionSelector, type Address } from "viem";
import { buildApi } from "../src/api/server.js";
import { applyLog } from "../src/indexer/index.js";
import { computeSeason, computeStandings, MAX_WINNERS } from "../src/season/scoring.js";
import { fastForwardSeason, secondsToSkip } from "../src/season/devclock.js";
import type { Services } from "../src/services.js";
import { FORGE_COIN, testServices } from "./helpers.js";

const E18 = 10n ** 18n;
const addr = (i: number) => `0x${(0x1000 + i).toString(16).padStart(40, "0")}` as Address;
const C1 = addr(900);
const C2 = addr(901);

let svc: Services;
let block = 10n;
let n = 0;
const emit = (eventName: string, args: Record<string, unknown>, opts: { address?: string; sameTx?: boolean } = {}) => {
  if (!opts.sameTx) n++;
  return applyLog(svc.db, {
    eventName,
    args,
    address: opts.address,
    blockNumber: block++,
    transactionHash: `0x${n.toString(16).padStart(64, "0")}`,
    logIndex: Number(block),
  });
};
const publish = (id: bigint, creator: string) => emit("LevelPublished", { id, creator, layoutHash: "0x" + id.toString(16).padStart(64, "0"), parentId: 0n, playFee: E18 });
const run = (player: string, levelId: bigint, timeMs: number, cleared: boolean) => emit("RunSettled", { player, levelId, timeMs, cleared, reward: 0n, feePaid: E18 });

beforeAll(() => {
  svc = testServices();
  publish(1n, C1);
  publish(2n, C2);
  // 12 players clear level 1 (slower each time) → only the top MAX_WINNERS are paid; player 0 holds the record.
  for (let i = 0; i < 12; i++) run(addr(i), 1n, 5000 + i * 10, true);
  run(addr(0), 2n, 4000, true); // player 0: 2 clears + 2 records = 6
  run(addr(5), 2n, 9000, false); // a failed paid run still counts for the creator
  run(C2, 2n, 1000, true); // self-play: ignored entirely
});
afterAll(() => svc.db.close());

describe("computeStandings", () => {
  it("ranks every scorer, flags the paid top 10 and gives the breakdown", () => {
    const st = computeStandings(svc.db);
    expect(st.season).toBe(1);
    expect(st.players).toHaveLength(12);
    expect(st.players[0]).toMatchObject({ address: addr(0), rank: 1, score: 6, primary: 2, secondary: 2, winner: true });
    expect(st.players[1]).toMatchObject({ address: addr(1), score: 1, primary: 1, secondary: 0 });
    expect(st.players.filter((p) => p.winner)).toHaveLength(MAX_WINNERS);
    expect(st.players.slice(MAX_WINNERS).every((p) => !p.winner && p.shareBps === 0)).toBe(true);
    // ties at 1 point are broken by the earlier block: addr(1) cleared before addr(2), …
    expect(st.players.slice(1, 4).map((p) => p.address)).toEqual([addr(1), addr(2), addr(3)]);
    // C1: 12 distinct paying players on 1 level; C2: player 0 and player 5 (the self-play does not count)
    expect(st.creators.map((c) => [c.address, c.score, c.primary, c.secondary])).toEqual([
      [C1, 12, 12, 1],
      [C2, 2, 2, 1],
    ]);
    expect(st.totals).toEqual({ runs: 14, clears: 13, activePlayers: 12, activeLevels: 2 });
  });

  it("winners' shares are exactly what computeSeason signs, summing to 10 000", () => {
    const st = computeStandings(svc.db);
    const signed = computeSeason(svc.db);
    const shares = [...st.players, ...st.creators].filter((x) => x.winner).map((x) => x.shareBps);
    expect(shares).toEqual(signed.shares);
    expect(signed.players).toHaveLength(MAX_WINNERS);
    expect(signed.shares.reduce((a, b) => a + b, 0)).toBe(10_000);
    // players' half: 6 + 9×1 = 15 points → 5000*6/15 = 2000, 5000/15 = 333 each, remainder 3000-2997=3 to the first
    expect(signed.shares.slice(0, MAX_WINNERS)).toEqual([2003, ...Array(9).fill(333)]);
    expect(signed.shares.slice(MAX_WINNERS)).toEqual([4285 + 1, 714]); // 5000*12/14 = 4285, 5000*2/14 = 714, +1 remainder
  });
});

describe("season payouts indexing", () => {
  it("records the ERC-20 transfers of the closeSeason tx as that season's payouts", () => {
    // an unrelated payout from the contract in another tx must not leak into the season
    emit("Transfer", { from: FORGE_COIN, to: addr(50), value: 7n }, { address: FORGE_COIN });
    // the closeSeason tx: two transfers out of the contract, a transfer between users (ignored), then SeasonClosed
    emit("Transfer", { from: FORGE_COIN, to: addr(0), value: 3n * E18 }, { address: FORGE_COIN });
    emit("Transfer", { from: addr(1), to: addr(2), value: 1n }, { address: FORGE_COIN, sameTx: true });
    emit("Transfer", { from: FORGE_COIN, to: C1, value: 2n * E18 }, { address: FORGE_COIN, sameTx: true });
    emit("SeasonClosed", { season: 1n, pool: 5n * E18 }, { address: FORGE_COIN, sameTx: true });
    // ERC-721 Transfer (has tokenId) still updates level owners, not payouts
    emit("Transfer", { from: C1, to: addr(60), tokenId: 1n }, { address: "0x5FbDB2315678afecb367f032d93F642f64180aa3" });
    const rows = svc.db.prepare("SELECT season, position, recipient, amount FROM season_payouts ORDER BY position").all();
    expect(rows).toEqual([
      { season: 1, position: 1, recipient: addr(0), amount: (3n * E18).toString() },
      { season: 1, position: 2, recipient: C1.toLowerCase(), amount: (2n * E18).toString() },
    ]);
    expect(svc.db.prepare("SELECT COUNT(*) AS c FROM forge_outflows").get()).toEqual({ c: 0 });
  });

  it("GET /season/standings shows the new season and the closed one with its payouts", async () => {
    const app = await buildApi(svc);
    const body = (await app.inject({ method: "GET", url: "/season/standings" })).json();
    expect(body).toMatchObject({ season: 2, players: [], creators: [], maxWinners: MAX_WINNERS });
    expect(body.closed[0]).toMatchObject({ season: 1, pool: (5n * E18).toString(), payouts: [{ position: 1, address: addr(0) }, { position: 2 }] });
    const one = await app.inject({ method: "GET", url: "/season/1/payouts" });
    expect(one.statusCode).toBe(200);
    expect(one.json().payouts).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: "/season/2/payouts" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/season/x/payouts" })).statusCode).toBe(400);
    await app.close();
  });
});

describe("devclock (local chain fast-forward)", () => {
  it("secondsToSkip lands on seasonEnd minus `leave`, never backwards", () => {
    expect(secondsToSkip(100n, 1000n)).toBe(900n);
    expect(secondsToSkip(100n, 1000n, 60n)).toBe(840n);
    expect(secondsToSkip(2000n, 1000n)).toBe(0n);
  });

  const fakeRpc = (chainId: number, calls: { method: string; params: unknown[] }[]) => {
    let ts = 1_000n;
    const seasonEnd = 1_000n + 30n * 86_400n;
    return async (_url: string, init: { body: string }) => {
      const { method, params } = JSON.parse(init.body) as { method: string; params: unknown[] };
      calls.push({ method, params });
      const result = (() => {
        switch (method) {
          case "eth_chainId":
            return `0x${chainId.toString(16)}`;
          case "eth_call": {
            const sel = (params[0] as { data: string }).data;
            return encodeAbiParameters([{ type: "uint256" }], [sel === toFunctionSelector("season()") ? 1n : seasonEnd]);
          }
          case "eth_getBlockByNumber":
            return { timestamp: `0x${ts.toString(16)}` };
          case "evm_increaseTime":
            ts += BigInt(params[0] as number);
            return "0x0";
          case "evm_mine":
            ts += 1n;
            return "0x0";
        }
        throw new Error(method);
      })();
      return { json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
    };
  };

  it("jumps the Hardhat clock past seasonEnd", async () => {
    const calls: { method: string; params: unknown[] }[] = [];
    const r = await fastForwardSeason({ rpcUrl: "x", forgeCoin: FORGE_COIN, fetch: fakeRpc(31337, calls) });
    expect(r.season).toBe(1n);
    expect(r.skipped).toBe(30n * 86_400n);
    expect(r.after).toBeGreaterThanOrEqual(r.seasonEnd);
    expect(calls.map((c) => c.method)).toContain("evm_increaseTime");
  });

  it("refuses any chain that is not local Hardhat", async () => {
    const calls: { method: string; params: unknown[] }[] = [];
    await expect(fastForwardSeason({ rpcUrl: "x", forgeCoin: FORGE_COIN, fetch: fakeRpc(11155111, calls) })).rejects.toThrow(/local Hardhat/);
    expect(calls.map((c) => c.method)).toEqual(["eth_chainId"]);
  });
});
