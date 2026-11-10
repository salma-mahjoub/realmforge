import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, isHex, verifyMessage, type Address, type Hex } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";

/**
 * Sign-In With Ethereum (EIP-4361) + short-lived session tokens.
 *
 * Flow: GET /auth/nonce -> the wallet signs an EIP-4361 message holding that nonce -> POST /auth/verify checks the
 * message (chain id, domain, nonce, time window) and the signature, then returns an HMAC-signed session token.
 * The token proves wallet ownership for a short time without a new wallet prompt (e.g. joining Colyseus rooms).
 *
 * Token format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "v1." + payload))>`.
 * It is stateless: the server keeps no session table, so a token cannot be revoked before it expires; the TTL is
 * kept short (SESSION_TTL_SEC, 1 h by default) for that reason.
 */

export interface SessionPayload {
  /** Checksummed wallet address. */
  sub: Address;
  chainId: number;
  /** Unix seconds. */
  iat: number;
  exp: number;
}

export interface SiweOptions {
  chainId: number;
  /** HMAC key (>= 32 bytes). A random per-process key is used when omitted: tokens then die with the process. */
  secret?: string;
  ttlSec: number;
  /** Accepted EIP-4361 `domain` values. Empty = any domain (local dev). */
  domains?: string[];
  /** Nonce lifetime: the wallet must sign within this window. */
  nonceTtlSec?: number;
  /** Oldest accepted `issuedAt` (clock skew + time spent in the wallet). */
  maxMessageAgeSec?: number;
  now?: () => number;
}

export class SiweError extends Error {}

const MAX_PENDING_NONCES = 10_000;
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export class SiweAuth {
  readonly ttlSec: number;
  private readonly secret: Buffer;
  private readonly nonces = new Map<string, number>(); // nonce -> expiry (ms)
  private readonly now: () => number;

  constructor(private readonly opts: SiweOptions) {
    if (opts.secret !== undefined && opts.secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
    this.secret = opts.secret ? Buffer.from(opts.secret) : randomBytes(32);
    this.ttlSec = opts.ttlSec;
    this.now = opts.now ?? Date.now;
  }

  /** Single-use nonce, valid for a few minutes. */
  issueNonce(): { nonce: string; expiresAt: number } {
    const now = this.now();
    if (this.nonces.size >= MAX_PENDING_NONCES) {
      for (const [n, exp] of this.nonces) if (exp <= now) this.nonces.delete(n);
      // still full: drop the oldest (Map keeps insertion order) rather than refusing everybody
      while (this.nonces.size >= MAX_PENDING_NONCES) this.nonces.delete(this.nonces.keys().next().value as string);
    }
    const nonce = generateSiweNonce();
    const expiresAt = now + (this.opts.nonceTtlSec ?? 300) * 1000;
    this.nonces.set(nonce, expiresAt);
    return { nonce, expiresAt };
  }

  /**
   * Checks an EIP-4361 message and its personal_sign signature; returns a session token.
   * `origin` is the request's Origin header: when present its host must equal the message domain, so a page on
   * another site cannot relay a message the user signed there.
   */
  async verify(message: string, signature: string, origin?: string): Promise<{ token: string; address: Address; expiresAt: number }> {
    if (!isHex(signature)) throw new SiweError("signature must be 0x-prefixed hex");
    let parsed: ReturnType<typeof parseSiweMessage>;
    try {
      parsed = parseSiweMessage(message);
    } catch {
      throw new SiweError("not an EIP-4361 message");
    }
    const { address, nonce, domain, chainId, version, issuedAt } = parsed;
    if (!address || !isAddress(address) || !nonce || !domain || version !== "1") throw new SiweError("not an EIP-4361 message");
    if (chainId !== this.opts.chainId) throw new SiweError(`wrong chain id ${chainId ?? "(none)"}: this server runs on ${this.opts.chainId}`);

    // The nonce is burnt by the first attempt that uses it, valid or not: a captured message cannot be replayed.
    const nonceExp = this.nonces.get(nonce);
    this.nonces.delete(nonce);
    const now = this.now();
    if (nonceExp === undefined || nonceExp <= now) throw new SiweError("unknown or expired nonce: request a new one");

    const domains = this.opts.domains ?? [];
    if (domains.length > 0 && !domains.includes(domain)) throw new SiweError(`domain ${domain} is not accepted by this server`);
    if (origin) {
      let host: string | null = null;
      try {
        host = new URL(origin).host;
      } catch {
        /* malformed origin */
      }
      if (host !== domain) throw new SiweError("message domain does not match the requesting site");
    }
    const maxAge = (this.opts.maxMessageAgeSec ?? 600) * 1000;
    if (!issuedAt || issuedAt.getTime() > now + 60_000 || issuedAt.getTime() < now - maxAge) throw new SiweError("issuedAt is missing or out of range");
    if (!validateSiweMessage({ message: parsed, time: new Date(now) })) throw new SiweError("message expired or not yet valid");

    const ok = await verifyMessage({ address, message, signature: signature as Hex }).catch(() => false);
    if (!ok) throw new SiweError("signature does not match the address in the message");
    return this.issue(address);
  }

  /** Mints a session token for an address whose ownership was just proven. */
  issue(address: Address): { token: string; address: Address; expiresAt: number } {
    const iat = Math.floor(this.now() / 1000);
    const payload: SessionPayload = { sub: getAddress(address), chainId: this.opts.chainId, iat, exp: iat + this.ttlSec };
    const body = `v1.${b64url(JSON.stringify(payload))}`;
    return { token: `${body}.${this.mac(body)}`, address: payload.sub, expiresAt: payload.exp * 1000 };
  }

  /** The session if the token is authentic, unexpired and for this chain; otherwise null. */
  verifyToken(token: unknown): SessionPayload | null {
    if (typeof token !== "string" || token.length > 1024) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return null;
    const body = `${parts[0]}.${parts[1]}`;
    const given = Buffer.from(parts[2], "base64url");
    const expected = Buffer.from(this.mac(body), "base64url");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
      const p = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as SessionPayload;
      if (!isAddress(p.sub) || p.chainId !== this.opts.chainId || typeof p.exp !== "number") return null;
      if (p.exp * 1000 <= this.now()) return null;
      return { ...p, sub: getAddress(p.sub) };
    } catch {
      return null;
    }
  }

  private mac(body: string): string {
    return createHmac("sha256", this.secret).update(body).digest("base64url");
  }
}
