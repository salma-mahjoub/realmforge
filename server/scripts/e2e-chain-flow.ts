/**
 * Scripted end-to-end chain flow against a local stack (npm run dev:chain + deploy:local + dev:server):
 *   faucet → POST /levels/pin → POST /levels/clear-proof → LevelNFT.publish → (indexer) →
 *   POST /runs/validate → approve + ForgeCoin.settleRun → POST /runs/validate → settleRunWithPermit (uint8 v)
 *   → read plays/clears/balances + API leaderboard / level file.
 *
 * Run: npm run e2e:chain (repo root) or `npx tsx scripts/e2e-chain-flow.ts` in server/.
 * Uses Hardhat's PUBLIC test accounts #2 (creator) and #3 (player) — local chain only.
 * The run trace is synthetic (a straight walk at plausible speed); the browser check covers real play.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  http,
  parseEventLogs,
  parseSignature,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hardhat } from "viem/chains";
import { keccak256, toHex } from "viem";
import { canonicalize } from "../src/level/canonical.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
process.loadEnvFile?.(resolve(HERE, "../.env"));
const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const levelNFT = process.env.LEVEL_NFT_ADDRESS as Address;
const forgeCoin = process.env.FORGE_COIN_ADDRESS as Address;
if (!levelNFT || !forgeCoin) throw new Error("LEVEL_NFT_ADDRESS / FORGE_COIN_ADDRESS missing (run npm run deploy:local)");

const levelAbi = JSON.parse(readFileSync(resolve(HERE, "../abi/LevelNFT.json"), "utf8")).abi;
const coinAbi = JSON.parse(readFileSync(resolve(HERE, "../abi/ForgeCoin.json"), "utf8")).abi;

// Hardhat default accounts #2 / #3 (public test keys).
const creator = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a");
const player = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");

const pub = createPublicClient({ chain: hardhat, transport: http(RPC) });
const wallet = (account: typeof creator) => createWalletClient({ account, chain: hardhat, transport: http(RPC) });

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

async function send(account: typeof creator, address: Address, abi: unknown, functionName: string, args: unknown[]) {
  const hash = await wallet(account).writeContract({ address, abi: abi as never, functionName, args } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  console.log(`  tx ${functionName.padEnd(20)} ${hash} gas=${receipt.gasUsed}`);
  return receipt;
}

const fmt = (v: bigint) => `${formatUnits(v, 18)} FORGE`;
const balance = (a: Address) => pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;

/** Synthetic trace: straight walk spawn → goal at 0.12 tiles/frame, sampled every 4 frames, hitting checkpoints in x order. */
function syntheticRun(level: { spawn: { x: number; y: number }; goal: { x: number; y: number }; entities: { id: number; type: string; x: number }[] }) {
  const { spawn, goal } = level;
  const speed = 0.12;
  const frames = Math.ceil(Math.abs(goal.x - spawn.x) / speed);
  const trace = [];
  for (let f = 0; f <= frames; f += 4) {
    const t = f / frames;
    trace.push({ f, x: +(spawn.x + (goal.x - spawn.x) * t).toFixed(3), y: +(spawn.y + (goal.y - spawn.y) * t).toFixed(3) });
  }
  if (trace[trace.length - 1]!.f !== frames) trace.push({ f: frames, x: goal.x, y: goal.y });
  const checkpoints = level.entities
    .filter((e) => e.type === "checkpoint")
    .sort((a, b) => a.x - b.x)
    .map((e) => ({ id: e.id, f: Math.round(((e.x - spawn.x) / (goal.x - spawn.x)) * frames) }));
  return { timeMs: Math.round((frames * 1000) / 60), cleared: true, coins: 3, trace, checkpoints };
}

async function main() {
  console.log(`API ${API} · RPC ${RPC}\nLevelNFT ${levelNFT}\nForgeCoin ${forgeCoin}`);
  const health = await api<{ status: string; signer: Address; contracts: unknown }>("/health");
  console.log("health:", JSON.stringify(health));

  // 1. faucet
  console.log("\n[1] faucet");
  for (const a of [creator, player]) {
    const claimed = (await pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "faucetClaimed", args: [a.address] })) as boolean;
    if (!claimed) await send(a, forgeCoin, coinAbi, "claimFaucet", []);
    console.log(`  ${a.address} balance ${fmt(await balance(a.address))}`);
  }

  // 2. pin (unique name per run so the layoutHash is new)
  console.log("\n[2] POST /levels/pin");
  const sample = JSON.parse(readFileSync(resolve(ROOT, "web/src/game/level/samples/seesaw-hell.level.v1.json"), "utf8"));
  const level = { ...sample, meta: { ...sample.meta, name: `Seesaw Hell e2e ${Date.now() % 1e6}` } };
  const pin = await api<{ layoutHash: Hex; tokenURI: string; levelCid: string; minTimeMs: number }>("/levels/pin", { level });
  const localHash = keccak256(toHex(canonicalize(level)));
  console.log(`  layoutHash ${pin.layoutHash} (local canonical hash ${localHash === pin.layoutHash ? "MATCHES" : "DIFFERS: " + localHash})`);
  console.log(`  levelCid ${pin.levelCid} tokenURI ${pin.tokenURI} minTimeMs ${pin.minTimeMs}`);

  // 3. clear proof
  console.log("\n[3] POST /levels/clear-proof");
  const run = syntheticRun(level);
  const proof = await api<{ proof: { creator: Address; layoutHash: Hex; deadline: string }; signature: Hex; signer: Address; tokenURI: string }>(
    "/levels/clear-proof",
    { creator: creator.address, layoutHash: pin.layoutHash, run },
  );
  console.log(`  signer ${proof.signer} deadline ${proof.proof.deadline} run ${run.timeMs} ms / ${run.trace.length} samples`);

  // 4. publish
  console.log("\n[4] LevelNFT.publish");
  const fee = parseUnits("5", 18);
  const rcpt = await send(creator, levelNFT, levelAbi, "publish", [pin.layoutHash, proof.tokenURI ?? pin.tokenURI, fee, 0n, BigInt(proof.proof.deadline), proof.signature]);
  const ev = parseEventLogs({ abi: levelAbi, logs: rcpt.logs, eventName: "LevelPublished" })[0] as unknown as { args: { id: bigint } };
  const id = ev.args.id;
  console.log(`  minted level #${id} tokenURI ${await pub.readContract({ address: levelNFT, abi: levelAbi, functionName: "tokenURI", args: [id] })}`);

  // 5. wait for the indexer (levelId → layoutHash)
  process.stdout.write("\n[5] waiting for indexer");
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${API}/levels/${id}`);
    if (r.ok) {
      const row = (await r.json()) as { name: string; layout_hash: string };
      console.log(` → indexed: name="${row.name}" layout_hash=${row.layout_hash}`);
      break;
    }
    process.stdout.write(".");
    await new Promise((res) => setTimeout(res, 500));
  }
  const file = await fetch(`${API}/levels/${id}/file`).then((r) => r.text());
  console.log(`  GET /levels/${id}/file keccak256 = ${keccak256(toHex(file))} (${keccak256(toHex(file)) === pin.layoutHash ? "== layoutHash" : "MISMATCH"})`);

  // 6. run validation + approve + settleRun
  console.log("\n[6] POST /runs/validate → approve + settleRun");
  const before = { creator: await balance(creator.address), player: await balance(player.address) };
  const signed = await api<{ result: { player: Address; levelId: string; timeMs: number; cleared: boolean; coins: number; nonce: string; deadline: string }; signature: Hex }>(
    "/runs/validate",
    { player: player.address, levelId: id.toString(), run },
  );
  const toResult = (r: typeof signed.result) => ({ ...r, levelId: BigInt(r.levelId), nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) });
  console.log(`  RunResult nonce ${signed.result.nonce} timeMs ${signed.result.timeMs}`);
  await send(player, forgeCoin, coinAbi, "approve", [forgeCoin, fee]);
  await send(player, forgeCoin, coinAbi, "settleRun", [toResult(signed.result), signed.signature]);

  // 7. second run with ERC-2612 permit (uint8 v)
  console.log("\n[7] POST /runs/validate → settleRunWithPermit (uint8 v)");
  const signed2 = await api<typeof signed>("/runs/validate", { player: player.address, levelId: id.toString(), run: { ...run, timeMs: run.timeMs + 500, trace: run.trace.map((s, i, a) => (i === a.length - 1 ? { ...s, f: s.f + 30 } : s)) } });
  const nonce = (await pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "nonces", args: [player.address] })) as bigint;
  const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const permitSig = await player.signTypedData({
    domain: { name: "RealmForge ForgeCoin", version: "1", chainId: 31337, verifyingContract: forgeCoin },
    types: { Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }] },
    primaryType: "Permit",
    message: { owner: player.address, spender: forgeCoin, value: fee, nonce, deadline: permitDeadline },
  });
  const { r, s, v, yParity } = parseSignature(permitSig);
  await send(player, forgeCoin, coinAbi, "settleRunWithPermit", [toResult(signed2.result), signed2.signature, Number(v ?? BigInt(yParity + 27)), r, s, permitDeadline]);

  // 8. reads
  console.log("\n[8] on-chain state");
  const lvl = (await pub.readContract({ address: levelNFT, abi: levelAbi, functionName: "levels", args: [id] })) as readonly unknown[];
  console.log(`  levels(${id}): plays=${lvl[4]} clears=${lvl[5]} bestTimeMs=${lvl[7]} bestPlayer=${lvl[8]}`);
  const after = { creator: await balance(creator.address), player: await balance(player.address) };
  console.log(`  creator ${fmt(before.creator)} → ${fmt(after.creator)} (owner share 70% of 2 × 5 FORGE fees)`);
  console.log(`  player  ${fmt(before.player)} → ${fmt(after.player)} (−2 fees + clear rewards)`);
  console.log(`  seasonPool ${fmt((await pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "seasonPool" })) as bigint)} treasury ${fmt((await pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "treasuryBalance" })) as bigint)}`);
  await new Promise((res) => setTimeout(res, 3000));
  const board = await api<{ entries: unknown[] }>(`/levels/${id}/leaderboard`);
  console.log(`  GET /levels/${id}/leaderboard: ${JSON.stringify(board.entries)}`);
  const row = await api<{ plays: number; clears: number; best_time_ms: number }>(`/levels/${id}`);
  console.log(`  GET /levels/${id}: plays=${row.plays} clears=${row.clears} best_time_ms=${row.best_time_ms}`);
  console.log("\nE2E CHAIN FLOW OK");
}

main().catch((err) => {
  console.error("E2E CHAIN FLOW FAILED:", err);
  process.exit(1);
});
