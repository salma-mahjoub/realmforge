import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "@colyseus/core";
import { Client } from "colyseus.js";
import { privateKeyToAccount } from "viem/accounts";
import { createGameServer } from "../src/game.js";
import { AUTH_ERROR, joinMessage } from "../src/rooms/BaseMatchRoom.js";
import type { Services } from "../src/services.js";
import { testServices } from "./helpers.js";

/** PUBLIC Hardhat test keys #2 and #3 — test-only. */
const host = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const guest = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");

let svc: Services;
let game: Server;
const PORT = 27_000 + Math.floor(Math.random() * 1000);
const url = `ws://127.0.0.1:${PORT}`;

beforeAll(async () => {
  svc = testServices();
  game = createGameServer({ signer: svc.signer, levels: svc.levels, sessions: svc.sessions });
  await game.listen(PORT, "127.0.0.1");
});
afterAll(async () => {
  await game.gracefullyShutdown(false);
  svc.db.close();
});

const rejection = (p: Promise<unknown>) => p.then(() => ({ code: 0, message: "joined" }), (e: { code: number; message: string }) => e);

describe("room join requires wallet ownership proof", () => {
  for (const kind of ["race", "coop"] as const) {
    it(`${kind}: refuses an unsigned create/join with a clear error`, async () => {
      const c = new Client(url);
      const e = await rejection(c.create(kind, { address: host.address }));
      expect(e.code).toBe(AUTH_ERROR);
      expect(e.message).toMatch(/sign in with Ethereum/);
    });
  }

  it("accepts a SIWE session token, refuses a token of another wallet or a forged one", async () => {
    const c = new Client(url);
    const a = await c.create("race", { address: host.address, token: svc.sessions.issue(host.address).token });
    const stolen = await rejection(c.joinById(a.roomId, { address: guest.address, token: svc.sessions.issue(host.address).token }));
    expect(stolen.code).toBe(AUTH_ERROR);
    expect(stolen.message).toMatch(/another wallet/);
    const forged = await rejection(c.joinById(a.roomId, { address: guest.address, token: "v1.e30.AAAA" }));
    expect(forged.code).toBe(AUTH_ERROR);
    const b = await c.joinById(a.roomId, { address: guest.address, token: svc.sessions.issue(guest.address).token });
    expect(b.sessionId).toBeTruthy();
    await a.leave();
    await b.leave();
  });

  it("still accepts the joinMessage signature, and refuses one made for another room or wallet", async () => {
    const c = new Client(url);
    const a = await c.create("coop", { address: host.address, token: svc.sessions.issue(host.address).token });
    const wrongRoom = await guest.signMessage({ message: joinMessage("ZZZZ", guest.address) });
    expect((await rejection(c.joinById(a.roomId, { address: guest.address, signature: wrongRoom }))).message).toMatch(/invalid join signature/);
    const byHost = await host.signMessage({ message: joinMessage(a.roomId, guest.address) });
    expect((await rejection(c.joinById(a.roomId, { address: guest.address, signature: byHost }))).code).toBe(AUTH_ERROR);
    const signature = await guest.signMessage({ message: joinMessage(a.roomId, guest.address) });
    const b = await c.joinById(a.roomId, { address: guest.address, signature });
    expect(b.sessionId).toBeTruthy();
    await a.leave();
    await b.leave();
  });
});
