import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApi } from "../src/api/server.js";
import { applyLog } from "../src/indexer/index.js";
import type { Services } from "../src/services.js";
import { PLAYER, testServices } from "./helpers.js";

const OTHER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

let svc: Services;
let app: Awaited<ReturnType<typeof buildApi>>;
let logIndex = 0;
let block = 10n;

const publish = (id: number, parentId: number, creator: string = PLAYER) =>
  applyLog(svc.db, {
    eventName: "LevelPublished",
    args: { id: BigInt(id), creator, layoutHash: "0x" + id.toString(16).padStart(64, "0"), parentId: BigInt(parentId), playFee: 0n },
    blockNumber: block++,
    transactionHash: `0x${(++logIndex).toString(16).padStart(64, "0")}`,
    logIndex: ++logIndex,
  });

const lineage = async (id: number | string) => app.inject({ method: "GET", url: `/levels/${id}/remixes` });

/**
 * Tree:      1
 *          /   \
 *         2     3
 *        / \
 *       4   5
 *       |
 *       6
 * plus 7 (original, unrelated)
 */
beforeAll(async () => {
  svc = testServices();
  app = await buildApi(svc);
  publish(1, 0);
  publish(2, 1, OTHER);
  publish(3, 1);
  publish(4, 2);
  publish(5, 2, OTHER);
  publish(6, 4);
  publish(7, 0);
});
afterAll(async () => {
  await app.close();
  svc.db.close();
});

describe("GET /levels/:id/remixes", () => {
  it("lists direct remixes of an original with their own remix counts, oldest first", async () => {
    const res = await lineage(1);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.levelId).toBe(1);
    expect(body.parentId).toBe(0);
    expect(body.ancestors).toEqual([]);
    expect(body.children.map((c: { id: number }) => c.id)).toEqual([2, 3]);
    expect(body.children.map((c: { remixes: number }) => c.remixes)).toEqual([2, 0]);
    expect(body.children[0].creator).toBe(OTHER.toLowerCase());
    expect(body.descendants).toBe(5);
    expect(body.truncated).toBe(false);
  });

  it("walks the ancestor chain root first, direct parent last", async () => {
    const body = (await lineage(6)).json();
    expect(body.parentId).toBe(4);
    expect(body.ancestors.map((a: { id: number }) => a.id)).toEqual([1, 2, 4]);
    expect(body.children).toEqual([]);
    expect(body.descendants).toBe(0);
  });

  it("returns level-row shaped entries the web maps with rowToSummary", async () => {
    const body = (await lineage(4)).json();
    expect(body.ancestors.map((a: { id: number }) => a.id)).toEqual([1, 2]);
    expect(body.children).toHaveLength(1);
    const child = body.children[0];
    expect(child).toMatchObject({ id: 6, parent_id: 4, remixes: 0, layout_hash: "0x" + "6".padStart(64, "0") });
    for (const k of ["play_fee", "plays", "clears", "created_at", "level_cid", "thumbnail_cid", "name", "theme"]) expect(child).toHaveProperty(k);
  });

  it("an unrelated original has no lineage", async () => {
    const body = (await lineage(7)).json();
    expect(body).toMatchObject({ ancestors: [], children: [], descendants: 0, truncated: false });
  });

  it("stops at an ancestor the indexer has not seen and flags the chain as truncated", async () => {
    publish(9, 8); // parent #8 never indexed (e.g. indexer started after it)
    const body = (await lineage(9)).json();
    expect(body.parentId).toBe(8);
    expect(body.ancestors).toEqual([]);
    expect(body.truncated).toBe(true);
  });

  it("404s an unknown level and 400s a bad id", async () => {
    expect((await lineage(999)).statusCode).toBe(404);
    expect((await lineage("abc")).statusCode).toBe(400);
  });

  it("parent_id is indexed", () => {
    const idx = svc.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'levels'").all() as { name: string }[];
    expect(idx.map((i) => i.name)).toContain("levels_parent");
  });
});
