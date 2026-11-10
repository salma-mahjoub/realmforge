import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../src/api/server.js";
import { applyLog } from "../src/indexer/index.js";
import type { Services } from "../src/services.js";
import { PLAYER, testServices } from "./helpers.js";

const CREATOR = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const E18 = 10n ** 18n;

let svc: Services;
let app: Awaited<ReturnType<typeof buildApi>>;
let logIndex = 0;
let block = 10n;

/** Feed one decoded log, in its own transaction unless a hash is given (to group events of one tx). */
const emit = (eventName: string, args: Record<string, unknown>, tx = `0x${(++logIndex).toString(16).padStart(64, "0")}`) =>
  applyLog(svc.db, { eventName, args, blockNumber: block++, transactionHash: tx, logIndex: ++logIndex });

beforeAll(async () => {
  svc = testServices({ REALM_BADGES_ADDRESS: "0x0000000000000000000000000000000000001234" });
  app = await buildApi(svc);
  emit("LevelPublished", { id: 1n, creator: CREATOR, layoutHash: "0x" + "11".repeat(32), parentId: 0n, playFee: 10n * E18 });
  // one paid, cleared run by PLAYER: LevelNFT.recordRun + ForgeCoin events of the same transaction
  const tx = "0x" + "ab".repeat(32);
  emit("RunRecorded", { id: 1n, player: PLAYER, timeMs: 5000, cleared: true }, tx);
  emit("NewRecord", { id: 1n, player: PLAYER, timeMs: 5000 }, tx);
  emit("FeeSplit", { levelId: 1n, owner: CREATOR, ownerAmt: 7n * E18, poolAmt: 2n * E18, treasuryAmt: E18 / 2n }, tx);
  emit("FeeBurned", { levelId: 1n, amount: E18 / 2n }, tx);
  emit("RunSettled", { player: PLAYER, levelId: 1n, timeMs: 5000, cleared: true, reward: 35n * E18, feePaid: 10n * E18 }, tx);
  // a second player who failed, then a listing
  emit("RunSettled", { player: OTHER, levelId: 1n, timeMs: 9000, cleared: false, reward: 0n, feePaid: 10n * E18 });
  emit("FeeSplit", { levelId: 1n, owner: CREATOR, ownerAmt: 7n * E18, poolAmt: 2n * E18, treasuryAmt: E18 / 2n });
  emit("Listed", { id: 1n, price: 10n ** 17n });
});
afterAll(async () => {
  await app.close();
  svc.db.close();
});

describe("indexed ForgeCoin events", () => {
  it("keeps the burned amount of a fee with its FeeSplit row", () => {
    const row = svc.db.prepare("SELECT owner_amt, pool_amt, treasury_amt, burned_amt FROM fee_splits ORDER BY id").get() as Record<string, string>;
    expect(row).toEqual({ owner_amt: (7n * E18).toString(), pool_amt: (2n * E18).toString(), treasury_amt: (E18 / 2n).toString(), burned_amt: (E18 / 2n).toString() });
  });

  it("derives the owner and pool share of a settled race from the pot", () => {
    const room = "0x" + "cd".repeat(32);
    emit("RaceCreated", { roomId: room, levelId: 1n, creator: PLAYER, stake: 10n * E18 });
    emit("RaceSettled", { roomId: room, first: PLAYER, second: OTHER, pot: 20n * E18 });
    const row = svc.db.prepare("SELECT owner, owner_amt, pool_amt FROM fee_splits WHERE source = 'race'").get() as Record<string, string>;
    expect(row.owner).toBe(CREATOR.toLowerCase());
    expect(row.owner_amt).toBe((2n * E18).toString()); // 10% of 20
    expect(row.pool_amt).toBe(E18.toString()); // 5% of 20
  });

  it("indexes SeasonClosed once", () => {
    emit("SeasonClosed", { season: 1n, pool: 5n * E18 });
    expect(svc.db.prepare("SELECT pool FROM seasons WHERE season = 1").get()).toEqual({ pool: (5n * E18).toString() });
  });
});

describe("stats routes", () => {
  it("shows event-earned badges and signs eligible single-use claim proofs", async () => {
    emit("RunRecorded", { id: 1n, player: OTHER, timeMs: 7000, cleared: true });
    const body = (await app.inject({ method: "GET", url: `/profiles/${OTHER}/badges` })).json();
    expect(body.claimable).toEqual(expect.arrayContaining([expect.objectContaining({ badgeId: 1, ref: "1", name: "First Clear" })]));
    const creatorBadges = (await app.inject({ method: "GET", url: `/profiles/${PLAYER}/badges` })).json();
    expect(creatorBadges.claimable).toEqual(expect.arrayContaining([expect.objectContaining({ badgeId: 2, ref: "1", name: "Record Holder" })]));
    expect(creatorBadges.claimable).not.toEqual(expect.arrayContaining([expect.objectContaining({ badgeId: 1, ref: "1" })]));
    const proof = await app.inject({ method: "POST", url: "/badges/claim-proof", payload: { holder: OTHER, badgeId: 1, ref: "1" } });
    expect(proof.statusCode).toBe(200);
    expect(proof.json().message).toMatchObject({ holder: OTHER, badgeId: "1", ref: "1" });
    const invalid = await app.inject({ method: "POST", url: "/badges/claim-proof", payload: { holder: PLAYER, badgeId: 1, ref: "1" } });
    expect(invalid.statusCode).toBe(403);
    emit("BadgeClaimed", { holder: OTHER, badgeId: 1n, ref: 1n });
    const after = (await app.inject({ method: "GET", url: `/profiles/${OTHER}/badges` })).json();
    expect(after.earned).toEqual(expect.arrayContaining([expect.objectContaining({ badgeId: 1, ref: "1", name: "First Clear" })]));
    expect(after.claimable).not.toEqual(expect.arrayContaining([expect.objectContaining({ badgeId: 1, ref: "1" })]));
    expect((await app.inject({ method: "POST", url: "/badges/claim-proof", payload: { holder: OTHER, badgeId: 1, ref: "1" } })).statusCode).toBe(409);
  });

  it("GET /levels/:id/activity lists the level's events, newest first", async () => {
    const res = await app.inject({ method: "GET", url: "/levels/1/activity" });
    expect(res.statusCode).toBe(200);
    const kinds = res.json().items.map((i: { kind: string }) => i.kind);
    expect(kinds[0]).toBe("Listed");
    expect(kinds).toEqual(expect.arrayContaining(["Published", "New record", "Clear", "Play fee", "Listed"]));
  });

  it("GET /levels/:id/earnings sums the owner share per day (play fees and race)", async () => {
    const body = (await app.inject({ method: "GET", url: "/levels/1/earnings" })).json();
    expect(BigInt(body.total)).toBe(16n * E18); // 7 + 7 from two fees, + 2 from the race
    expect(body.days.reduce((a: number, d: { forge: number }) => a + d.forge, 0)).toBe(16);
  });

  it("GET /levels/:id reports what the owner earned", async () => {
    const body = (await app.inject({ method: "GET", url: "/levels/1" })).json();
    expect(BigInt(body.earned)).toBe(16n * E18);
  });

  it("GET /profiles/:address summarises a player", async () => {
    const body = (await app.inject({ method: "GET", url: `/profiles/${PLAYER}` })).json();
    expect(body).toMatchObject({ address: PLAYER.toLowerCase(), plays: 1, clears: 1, bestRank: 1 });
    expect(body.recentClears[0]).toMatchObject({ timeMs: 5000, reward: (35n * E18).toString() });
    const creator = (await app.inject({ method: "GET", url: `/profiles/${CREATOR}` })).json();
    expect(creator.created).toHaveLength(1);
    expect(creator.owned).toHaveLength(1);
  });

  it("GET /profiles/:address rejects a malformed address and gives an empty profile to an unknown one", async () => {
    expect((await app.inject({ method: "GET", url: "/profiles/nope" })).statusCode).toBe(400);
    const empty = (await app.inject({ method: "GET", url: "/profiles/0x0000000000000000000000000000000000000001" })).json();
    expect(empty).toMatchObject({ plays: 0, clears: 0, bestRank: null, created: [], owned: [], recentClears: [] });
  });

  it("GET /market/listings returns the listed levels", async () => {
    const body = (await app.inject({ method: "GET", url: "/market/listings" })).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: 1, listing_price: (10n ** 17n).toString() });
  });

  it("derives creator and race badges from their indexed events and excludes a creator's own first clear", async () => {
    const room = `0x${"ef".repeat(32)}`;
    emit("RaceCreated", { roomId: room, levelId: 1n, creator: OTHER, stake: E18 });
    emit("RaceSettled", { roomId: room, first: PLAYER, second: OTHER, pot: 2n * E18 });
    emit("LevelPublished", { id: 2n, creator: PLAYER, layoutHash: "0x" + "22".repeat(32), parentId: 0n, playFee: 0n });
    emit("RunRecorded", { id: 2n, player: PLAYER, timeMs: 4000, cleared: true });
    const body = (await app.inject({ method: "GET", url: `/profiles/${PLAYER}/badges` })).json();
    expect(body.claimable).toEqual(expect.arrayContaining([
      expect.objectContaining({ badgeId: 3, ref: BigInt(room).toString(), name: "Race Winner" }),
      expect.objectContaining({ badgeId: 4, ref: "2", name: "Creator" }),
    ]));
    expect(body.claimable).not.toEqual(expect.arrayContaining([expect.objectContaining({ badgeId: 1, ref: "2" })]));
  });
});
