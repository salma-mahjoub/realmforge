import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { SiweAuth, SiweError } from "../src/auth/siwe.js";
import { TokenBucket, requestAddress } from "../src/api/rateLimit.js";
import { buildApi } from "../src/api/server.js";
import type { Services } from "../src/services.js";
import { makeLevel, makeRun, testServices } from "./helpers.js";

/** PUBLIC Hardhat test key #2 — test-only. */
const wallet = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const other = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");

function siwe(nonce: string, over: Partial<Parameters<typeof createSiweMessage>[0]> = {}) {
  return createSiweMessage({
    domain: "localhost:8080",
    address: wallet.address,
    statement: "Sign in to RealmForge.",
    uri: "http://localhost:8080",
    version: "1",
    chainId: 31337,
    nonce,
    issuedAt: new Date(),
    ...over,
  });
}

describe("SiweAuth", () => {
  const auth = new SiweAuth({ chainId: 31337, ttlSec: 3600, secret: "x".repeat(32) });

  it("verifies a signed EIP-4361 message and issues a token for that address", async () => {
    const { nonce } = auth.issueNonce();
    const message = siwe(nonce);
    const s = await auth.verify(message, await wallet.signMessage({ message }), "http://localhost:8080");
    expect(s.address).toBe(wallet.address);
    expect(auth.verifyToken(s.token)?.sub).toBe(wallet.address);
  });

  it("burns the nonce: the same signed message cannot be replayed", async () => {
    const { nonce } = auth.issueNonce();
    const message = siwe(nonce);
    const sig = await wallet.signMessage({ message });
    await auth.verify(message, sig);
    await expect(auth.verify(message, sig)).rejects.toThrow(/nonce/);
  });

  it("rejects an unknown nonce, a wrong chain, a wrong signer, a foreign origin and an expired message", async () => {
    const bad = async (message: string, sig?: `0x${string}`, origin?: string) => auth.verify(message, sig ?? (await wallet.signMessage({ message })), origin);
    await expect(bad(siwe("unknownnonce123"))).rejects.toThrow(/nonce/);
    await expect(bad(siwe(auth.issueNonce().nonce, { chainId: 1 }))).rejects.toThrow(/chain id/);
    const m = siwe(auth.issueNonce().nonce);
    await expect(bad(m, await other.signMessage({ message: m }))).rejects.toThrow(/signature/);
    await expect(bad(siwe(auth.issueNonce().nonce), undefined, "https://evil.example")).rejects.toThrow(/domain/);
    await expect(bad(siwe(auth.issueNonce().nonce, { expirationTime: new Date(Date.now() - 1000) }))).rejects.toThrow(/expired/);
    await expect(bad(siwe(auth.issueNonce().nonce, { issuedAt: new Date(Date.now() - 3_600_000) }))).rejects.toThrow(/issuedAt/);
    await expect(auth.verify("hello", "0x00")).rejects.toBeInstanceOf(SiweError);
  });

  it("enforces the configured domains", async () => {
    const strict = new SiweAuth({ chainId: 31337, ttlSec: 60, domains: ["realmforge.example"] });
    const message = siwe(strict.issueNonce().nonce);
    await expect(strict.verify(message, await wallet.signMessage({ message }))).rejects.toThrow(/not accepted/);
  });

  it("rejects tampered, foreign-key and expired tokens", () => {
    let now = Date.now();
    const a = new SiweAuth({ chainId: 31337, ttlSec: 60, secret: "a".repeat(32), now: () => now });
    const { token } = a.issue(wallet.address);
    const [v, payload, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), sub: other.address })).toString("base64url");
    expect(a.verifyToken(`${v}.${forged}.${mac}`)).toBeNull();
    expect(new SiweAuth({ chainId: 31337, ttlSec: 60, secret: "b".repeat(32) }).verifyToken(token)).toBeNull();
    expect(new SiweAuth({ chainId: 1, ttlSec: 60, secret: "a".repeat(32) }).verifyToken(token)).toBeNull();
    expect(a.verifyToken("garbage")).toBeNull();
    expect(a.verifyToken(token)?.sub).toBe(wallet.address);
    now += 61_000;
    expect(a.verifyToken(token)).toBeNull();
  });
});

describe("TokenBucket", () => {
  it("allows `capacity` requests then refills over the window", () => {
    let now = 0;
    const b = new TokenBucket(3, 60_000, () => now);
    expect([b.take("k"), b.take("k"), b.take("k")]).toEqual([0, 0, 0]);
    expect(b.take("k")).toBeGreaterThan(0);
    expect(b.take("other")).toBe(0);
    now += 20_000; // one token back
    expect(b.take("k")).toBe(0);
    expect(b.take("k")).toBeGreaterThan(0);
  });

  it("reads the acting address from the body", () => {
    expect(requestAddress({ player: wallet.address })).toBe(wallet.address.toLowerCase());
    expect(requestAddress({ creator: other.address })).toBe(other.address.toLowerCase());
    expect(requestAddress({ message: siwe("abcdefgh12345") })).toBe(wallet.address.toLowerCase());
    expect(requestAddress({ player: "nope" })).toBeNull();
  });
});

describe("API /auth + rate limits", () => {
  let svc: Services;
  let app: Awaited<ReturnType<typeof buildApi>>;
  beforeAll(async () => {
    svc = testServices({ RATE_LIMIT_IP_PER_MIN: "6", RATE_LIMIT_ADDRESS_PER_MIN: "3" });
    app = await buildApi(svc);
  });
  afterAll(async () => {
    await app.close();
    svc.db.close();
  });

  it("GET /auth/nonce -> POST /auth/verify -> GET /auth/session", async () => {
    const { nonce } = (await app.inject({ method: "GET", url: "/auth/nonce" })).json();
    const message = siwe(nonce);
    const res = await app.inject({
      method: "POST",
      url: "/auth/verify",
      headers: { origin: "http://localhost:8080" },
      payload: { message, signature: await wallet.signMessage({ message }) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.address).toBe(wallet.address);
    expect(body.ttlSec).toBe(3600);
    expect(svc.sessions.verifyToken(body.token)?.sub).toBe(wallet.address);
    const me = await app.inject({ method: "GET", url: "/auth/session", headers: { authorization: `Bearer ${body.token}` } });
    expect(me.json()).toMatchObject({ address: wallet.address });
    expect((await app.inject({ method: "GET", url: "/auth/session" })).statusCode).toBe(401);
  });

  it("POST /auth/verify answers 401 with the reason", async () => {
    const message = siwe("neverissued123");
    const res = await app.inject({ method: "POST", url: "/auth/verify", payload: { message, signature: await wallet.signMessage({ message }) } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toMatch(/sign-in rejected: unknown or expired nonce/);
    expect((await app.inject({ method: "POST", url: "/auth/verify", payload: { message } })).statusCode).toBe(400);
  });

  it("POST /runs/validate is limited per address, then per IP (429 + Retry-After)", async () => {
    const payload = (player: string) => ({ player, levelId: "999", run: makeRun() });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: "POST", url: "/runs/validate", payload: payload(wallet.address) })).statusCode);
    expect(codes).toEqual([404, 404, 404, 429]); // level 999 unknown: the handler ran 3 times, then the address bucket was empty
    const limited = await app.inject({ method: "POST", url: "/runs/validate", payload: payload(wallet.address) });
    expect(limited.headers["retry-after"]).toMatch(/^\d+$/);
    expect(limited.json().error).toMatch(/address/);
    // 5 requests so far from this IP; the 6th is allowed (another address), the 7th is not
    expect((await app.inject({ method: "POST", url: "/runs/validate", payload: payload(other.address) })).statusCode).toBe(404);
    const ipLimited = await app.inject({ method: "POST", url: "/runs/validate", payload: payload(other.address) });
    expect(ipLimited.statusCode).toBe(429);
    expect(ipLimited.json().error).toMatch(/IP/);
    // other routes have their own buckets; unlimited routes are untouched
    expect((await app.inject({ method: "POST", url: "/levels/pin", payload: { level: makeLevel() } })).statusCode).toBe(201);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });
});
