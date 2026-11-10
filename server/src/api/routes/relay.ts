import type { FastifyInstance } from "fastify";
import { createPublicClient, createWalletClient, http, verifyTypedData, type Address, type Hex } from "viem";
import { z } from "zod";
import { forgeCoinDomain, runResultTypes } from "../../eip712.js";
import { loadAbi } from "../../indexer/abi.js";
import type { RunResult } from "../../eip712.js";
import type { Services } from "../../services.js";

const run = z.object({ player: z.string(), levelId: z.string(), timeMs: z.number().int().nonnegative(), cleared: z.boolean(), coins: z.number().int().nonnegative(), nonce: z.string(), deadline: z.string() });
const bodySchema = z.strictObject({ result: run, signature: z.string(), playerSignature: z.string(), permit: z.strictObject({ v: z.number().int().min(27).max(28), r: z.string(), s: z.string(), deadline: z.string() }) });
const forgeCoinAbi = loadAbi("ForgeCoin");

export function relayRoutes(app: FastifyInstance, svc: Services) {
  app.get("/relay/status", async () => ({ enabled: !!svc.relayer, dailyQuota: svc.config.RELAY_DAILY_QUOTA, gasLimit: svc.config.RELAY_GAS_LIMIT }));
  app.post("/relay/settle", async (req, reply) => {
    if (!svc.relayer) return reply.code(503).send({ error: "gasless relayer is disabled" });
    if (!svc.config.FORGE_COIN_ADDRESS) return reply.code(503).send({ error: "ForgeCoin address is not configured" });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid body" });
    const { result: raw, signature, playerSignature, permit } = parsed.data;
    if (!/^0x[\da-f]{40}$/i.test(raw.player) || !/^0x[\da-f]{64}$/i.test(permit.r) || !/^0x[\da-f]{64}$/i.test(permit.s)) return reply.code(400).send({ error: "invalid signature fields" });
    const r: RunResult = { player: raw.player as Address, levelId: BigInt(raw.levelId), timeMs: raw.timeMs, cleared: raw.cleared, coins: raw.coins, nonce: BigInt(raw.nonce), deadline: BigInt(raw.deadline) };
    if (r.deadline <= BigInt(Math.floor(Date.now() / 1000))) return reply.code(400).send({ error: "RunResult expired" });
    const serverSignatureValid = await verifyTypedData({ address: svc.signer.address, domain: forgeCoinDomain(svc.config.CHAIN_ID, svc.config.FORGE_COIN_ADDRESS), types: runResultTypes, primaryType: "RunResult", message: r, signature: signature as Hex }).catch(() => false);
    if (!serverSignatureValid) return reply.code(403).send({ error: "invalid server RunResult signature" });
    const saved = svc.db.prepare("SELECT player, level_id, time_ms, cleared, coins FROM signed_runs WHERE nonce = ? AND kind = 'run'").get(r.nonce.toString()) as { player: string; level_id: string; time_ms: number; cleared: number; coins: number } | undefined;
    if (!saved || saved.player !== r.player.toLowerCase() || saved.level_id !== r.levelId.toString() || saved.time_ms !== r.timeMs || saved.cleared !== Number(r.cleared) || saved.coins !== r.coins) return reply.code(403).send({ error: "RunResult was not issued by this server" });
    const day = Math.floor(Date.now() / 86_400_000);
    const used = svc.db.prepare("SELECT COUNT(*) AS n FROM relay_submissions WHERE player = ? AND day = ?").get(r.player.toLowerCase(), day) as { n: number };
    if (used.n >= svc.config.RELAY_DAILY_QUOTA) return reply.code(429).send({ error: "daily relayer quota reached" });
    const claim = svc.db.prepare("INSERT OR IGNORE INTO relay_submissions (player, day, nonce, created_at) VALUES (?, ?, ?, ?)").run(r.player.toLowerCase(), day, r.nonce.toString(), Date.now());
    if (!claim.changes) return reply.code(409).send({ error: "run already submitted to relayer" });
    const account = svc.relayer;
    const chain = { id: svc.config.CHAIN_ID, name: "RealmForge", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [svc.config.RPC_URL] } } } as const;
    const transport = http(svc.config.RPC_URL);
    const publicClient = createPublicClient({ chain, transport });
    const wallet = createWalletClient({ account, chain, transport });
    try {
      const hash = await wallet.writeContract({ address: svc.config.FORGE_COIN_ADDRESS, abi: forgeCoinAbi, functionName: "settleRunFor", args: [r, signature as Hex, playerSignature as Hex, permit.v, permit.r as Hex, permit.s as Hex, BigInt(permit.deadline)], gas: BigInt(svc.config.RELAY_GAS_LIMIT) });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("settlement transaction reverted");
      return { hash, relayer: account.address };
    } catch (error) {
      svc.db.prepare("DELETE FROM relay_submissions WHERE nonce = ?").run(r.nonce.toString());
      req.log.warn({ err: error }, "gasless settlement failed");
      return reply.code(422).send({ error: "settlement transaction failed" });
    }
  });
}
