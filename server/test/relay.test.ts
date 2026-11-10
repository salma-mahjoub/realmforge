import { afterEach, describe, expect, it } from "vitest";
import { buildApi } from "../src/api/server.js";
import { createServices } from "../src/services.js";
import { PLAYER, testConfig } from "./helpers.js";

const RELAYER_KEY = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
const active: { app?: Awaited<ReturnType<typeof buildApi>>; db?: ReturnType<typeof createServices>["db"] } = {};
afterEach(async () => { await active.app?.close(); active.db?.close(); active.app = undefined; active.db = undefined; });

describe("gasless relay API", () => {
  it("reports disabled when RELAYER_PRIVATE_KEY is unset", async () => {
    const svc = createServices(testConfig()); active.db = svc.db;
    active.app = await buildApi(svc);
    const res = await active.app.inject({ method: "GET", url: "/relay/status" });
    expect(res.json()).toMatchObject({ enabled: false, dailyQuota: 10, gasLimit: 500000 });
    const disabled = await active.app.inject({ method: "POST", url: "/relay/settle", payload: {} });
    expect(disabled.statusCode).toBe(503);
  });

  it("rejects non-server-signed RunResults before any chain submission", async () => {
    const svc = createServices(testConfig({ RELAYER_PRIVATE_KEY: RELAYER_KEY })); active.db = svc.db;
    active.app = await buildApi(svc);
    expect((await active.app.inject({ method: "GET", url: "/relay/status" })).json().enabled).toBe(true);
    const response = await active.app.inject({ method: "POST", url: "/relay/settle", payload: {
      result: { player: PLAYER, levelId: "1", timeMs: 1000, cleared: true, coins: 0, nonce: "7", deadline: String(Math.floor(Date.now() / 1000) + 60) },
      signature: `0x${"00".repeat(65)}`, playerSignature: `0x${"00".repeat(65)}`,
      permit: { v: 27, r: `0x${"00".repeat(32)}`, s: `0x${"00".repeat(32)}`, deadline: String(Math.floor(Date.now() / 1000) + 60) },
    } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("invalid server RunResult signature");
  });
});
