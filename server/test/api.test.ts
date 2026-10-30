import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keccak256, verifyTypedData, type Hex } from "viem";
import { buildApi } from "../src/api/server.js";
import { clearProofTypes, forgeCoinDomain, levelNftDomain, runResultTypes } from "../src/eip712.js";
import { applyLog } from "../src/indexer/index.js";
import type { Services } from "../src/services.js";
import { FORGE_COIN, LEVEL_NFT, PLAYER, TEST_SIGNER, makeLevel, makeRun, testServices } from "./helpers.js";

let svc: Services;
let app: Awaited<ReturnType<typeof buildApi>>;

beforeAll(async () => {
  svc = testServices();
  app = await buildApi(svc);
});
afterAll(async () => {
  await app.close();
  svc.db.close();
});

describe("API", () => {
  it("GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ status: "ok", chainId: 31337, signer: TEST_SIGNER, ipfs: "local" });
    expect(body.contracts.levelNFT).toBe(LEVEL_NFT);
  });

  let pinned: { layoutHash: Hex; levelCid: string; metadataCid: string; tokenURI: string };

  it("POST /levels/pin stores canonical JSON locally and returns a CID + layoutHash", async () => {
    const thumb = "data:image/png;base64," + Buffer.from("\x89PNG fake").toString("base64");
    const res = await app.inject({ method: "POST", url: "/levels/pin", payload: { level: makeLevel(), thumbnail: thumb } });
    expect(res.statusCode).toBe(201);
    pinned = res.json();
    expect(pinned.layoutHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(pinned.levelCid).toMatch(/^bafkrei[a-z2-7]+$/);
    expect(pinned.tokenURI).toBe(`ipfs://${pinned.metadataCid}`);

    const file = join(svc.config.DATA_DIR, "ipfs", pinned.levelCid);
    expect(existsSync(file)).toBe(true);
    // Pinned bytes hash to the layoutHash stored on-chain.
    expect(keccak256(readFileSync(file))).toBe(pinned.layoutHash);

    const meta = await app.inject({ method: "GET", url: `/ipfs/${pinned.metadataCid}` });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().properties.layoutHash).toBe(pinned.layoutHash);
  });

  it("POST /levels/pin gives the same hash for reordered keys", async () => {
    const lvl = makeLevel();
    const reordered = { goal: lvl.goal, spawn: lvl.spawn, entities: lvl.entities, layers: lvl.layers, size: lvl.size, meta: lvl.meta, schema: 1 };
    const res = await app.inject({ method: "POST", url: "/levels/pin", payload: { level: reordered } });
    expect(res.statusCode).toBe(201);
    expect(res.json().layoutHash).toBe(pinned.layoutHash);
  });

  it("POST /levels/pin rejects an invalid level with 400", async () => {
    const bad = { ...makeLevel(), size: { w: 9999, h: 30, tile: 18 } };
    const res = await app.inject({ method: "POST", url: "/levels/pin", payload: { level: bad } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid level");
  });

  it("POST /levels/clear-proof signs a ClearProof for a valid clear", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/levels/clear-proof",
      payload: { creator: PLAYER, layoutHash: pinned.layoutHash, run: makeRun() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ok = await verifyTypedData({
      address: TEST_SIGNER,
      domain: levelNftDomain(31337, LEVEL_NFT),
      types: clearProofTypes,
      primaryType: "ClearProof",
      message: { creator: body.proof.creator, layoutHash: body.proof.layoutHash, deadline: BigInt(body.proof.deadline) },
      signature: body.signature,
    });
    expect(ok).toBe(true);
  });

  it("POST /levels/clear-proof rejects an implausible run with 422", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/levels/clear-proof",
      payload: { creator: PLAYER, layoutHash: pinned.layoutHash, run: makeRun({ speed: 0.8 }) },
    });
    expect(res.statusCode).toBe(422);
  });

  it("indexer events feed /levels, /runs/validate and the leaderboard", async () => {
    const base = { blockNumber: 10n, logIndex: 0 };
    applyLog(svc.db, {
      ...base,
      transactionHash: "0xaa",
      eventName: "LevelPublished",
      args: { id: 1n, creator: PLAYER, layoutHash: pinned.layoutHash, parentId: 0n, playFee: 10n ** 18n },
    });
    // Re-applying the same log is a no-op (idempotent).
    expect(applyLog(svc.db, { ...base, transactionHash: "0xaa", eventName: "LevelPublished", args: { id: 1n, creator: PLAYER, layoutHash: pinned.layoutHash, parentId: 0n, playFee: 0n } })).toBe(false);

    const list = await app.inject({ method: "GET", url: "/levels?sort=new" });
    expect(list.json().items).toHaveLength(1);
    expect(list.json().items[0]).toMatchObject({ id: 1, play_fee: "1000000000000000000", level_cid: pinned.levelCid });

    const res = await app.inject({ method: "POST", url: "/runs/validate", payload: { player: PLAYER, levelId: "1", run: makeRun() } });
    expect(res.statusCode).toBe(200);
    const { result, signature } = res.json();
    const ok = await verifyTypedData({
      address: TEST_SIGNER,
      domain: forgeCoinDomain(31337, FORGE_COIN),
      types: runResultTypes,
      primaryType: "RunResult",
      message: {
        player: result.player,
        levelId: BigInt(result.levelId),
        timeMs: result.timeMs,
        cleared: result.cleared,
        coins: result.coins,
        nonce: BigInt(result.nonce),
        deadline: BigInt(result.deadline),
      },
      signature,
    });
    expect(ok).toBe(true);

    applyLog(svc.db, { blockNumber: 11n, logIndex: 1, transactionHash: "0xbb", eventName: "RunRecorded", args: { id: 1n, player: PLAYER, timeMs: 6000, cleared: true } });
    applyLog(svc.db, { blockNumber: 12n, logIndex: 1, transactionHash: "0xcc", eventName: "RunRecorded", args: { id: 1n, player: PLAYER, timeMs: 5500, cleared: true } });
    const lb = await app.inject({ method: "GET", url: "/levels/1/leaderboard" });
    expect(lb.json().entries).toEqual([{ rank: 1, player: PLAYER.toLowerCase(), timeMs: 5500, clears: 2 }]);
    const lvl = await app.inject({ method: "GET", url: "/levels/1" });
    expect(lvl.json()).toMatchObject({ plays: 2, clears: 2 });

    const replays = await app.inject({ method: "GET", url: "/levels/1/replays" });
    expect(replays.json().replays).toHaveLength(1);
  });

  it("POST /runs/validate returns 404 for unknown levels", async () => {
    const res = await app.inject({ method: "POST", url: "/runs/validate", payload: { player: PLAYER, levelId: 999, run: makeRun() } });
    expect(res.statusCode).toBe(404);
  });
});
