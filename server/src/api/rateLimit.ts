import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isAddress } from "viem";
import { parseSiweMessage } from "viem/siwe";

/**
 * Small in-memory token bucket (no @fastify/rate-limit in the dependency tree). Each key holds up to `capacity`
 * tokens and regains `capacity` tokens per `windowMs`, continuously. One process only: behind several instances
 * this would need a shared store (Redis), which is out of scope for the demo.
 */
export class TokenBucket {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private lastSweep = 0;

  constructor(
    readonly capacity: number,
    readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Takes one token. Returns 0 when allowed, otherwise the milliseconds until a token is available. */
  take(key: string): number {
    const now = this.now();
    this.sweep(now);
    const rate = this.capacity / this.windowMs; // tokens per ms
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * rate);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / rate);
  }

  get size() {
    return this.buckets.size;
  }

  /** Forget full buckets now and then so the map does not grow with every IP ever seen. */
  private sweep(now: number) {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (b.tokens + (now - b.at) * (this.capacity / this.windowMs) >= this.capacity) this.buckets.delete(k);
  }
}

/**
 * Endpoints that make the server sign something (or start a signing flow). Other features adding a signing
 * endpoint should append its route here.
 */
export const SIGNING_ROUTES = new Set(["/runs/validate", "/levels/clear-proof", "/season/close-proof", "/auth/nonce", "/auth/verify", "/badges/claim-proof", "/relay/settle"]);

/** Wallet address a request acts for: `player` / `creator` / `address` in the body, or the address in a SIWE message. */
export function requestAddress(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  for (const k of ["player", "creator", "address"]) {
    const v = b[k];
    if (typeof v === "string" && isAddress(v)) return v.toLowerCase();
  }
  if (typeof b.message === "string" && b.message.length < 4096) {
    try {
      const a = parseSiweMessage(b.message).address;
      if (a && isAddress(a)) return a.toLowerCase();
    } catch {
      /* not a SIWE message */
    }
  }
  return null;
}

export interface RateLimitOptions {
  perIpPerMin: number;
  perAddressPerMin: number;
  routes?: Set<string>;
  now?: () => number;
}

/**
 * Per-IP and per-address limits on the signing endpoints. Runs as a preHandler, after body parsing, so the
 * address in the body is known. The per-address bucket stops one wallet spreading requests over many IPs;
 * the per-IP bucket stops one client cycling through fresh addresses.
 */
export function registerRateLimit(app: FastifyInstance, opts: RateLimitOptions) {
  const routes = opts.routes ?? SIGNING_ROUTES;
  const byIp = new TokenBucket(opts.perIpPerMin, 60_000, opts.now);
  const byAddress = new TokenBucket(opts.perAddressPerMin, 60_000, opts.now);
  const reject = (reply: FastifyReply, waitMs: number, scope: string) => {
    const sec = Math.max(1, Math.ceil(waitMs / 1000));
    return reply
      .code(429)
      .header("Retry-After", String(sec))
      .send({ error: `too many requests from this ${scope}: retry in ${sec} s`, retryAfterSec: sec });
  };
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method !== "POST" && req.method !== "GET") return;
    const route = req.routeOptions.url;
    if (!route || !routes.has(route)) return;
    const ipWait = byIp.take(`${route}|${req.ip}`);
    if (ipWait > 0) return reject(reply, ipWait, "IP");
    const addr = requestAddress(req.body);
    if (addr) {
      const addrWait = byAddress.take(`${route}|${addr}`);
      if (addrWait > 0) return reject(reply, addrWait, "address");
    }
  });
}
