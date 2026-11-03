/**
 * Scripted season close against the local stack (after `npm run e2e:chain`, which creates the plays):
 * the server computes the ranking from the indexed events and signs it (POST /season/close-proof), the chain clock
 * jumps past the season end, and the admin submits ForgeCoin.closeSeason with that signature.
 *
 * Run: `API_URL=http://localhost:8787 npx tsx scripts/e2e-season-flow.ts` in server/. The admin is Hardhat account #0,
 * the deployer of `npm run deploy:local` (local chain only).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatUnits, http, type Address, type Hex } from "viem";
import { hardhat } from "viem/chains";

const HERE = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile?.(resolve(HERE, "../.env"));
const API = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const forgeCoin = process.env.FORGE_COIN_ADDRESS as Address;
const coinAbi = JSON.parse(readFileSync(resolve(HERE, "../abi/ForgeCoin.json"), "utf8")).abi;
const pub = createPublicClient({ chain: hardhat, transport: http(RPC) });
const rpc = (method: string, params: unknown[] = []) =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json()) as Promise<{ result: unknown }>;
const read = <T>(functionName: string, args: unknown[] = []) => pub.readContract({ address: forgeCoin, abi: coinAbi, functionName, args }) as Promise<T>;
const fmt = (v: bigint) => formatUnits(v, 18);
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
};

async function main() {
  const admin = ((await rpc("eth_accounts")).result as Address[])[0]!;
  const season = (await read<bigint>("season"));
  console.log(`season on-chain: ${season}, pool ${fmt(await read<bigint>("seasonPool"))} FORGE`);

  console.log("\n[1] the server computes and signs the ranking");
  const proof = (await fetch(`${API}/season/close-proof`, { method: "POST" }).then((r) => r.json())) as {
    ranking: { season: number; players: { address: Address; score: number }[]; creators: { address: Address; score: number }[]; shares: number[] };
    message: { season: string; players: Address[]; creators: Address[]; shares: string[] };
    signature: Hex;
  };
  console.log("  players:", proof.ranking.players.map((p) => `${p.address.slice(0, 8)}…=${p.score}`).join(", ") || "none");
  console.log("  creators:", proof.ranking.creators.map((c) => `${c.address.slice(0, 8)}…=${c.score}`).join(", ") || "none");
  console.log("  shares (bps):", proof.message.shares.join(", "));
  check("the signed season is the on-chain season", BigInt(proof.message.season) === season);
  check("shares sum to 10 000", proof.message.shares.reduce((a, b) => a + BigInt(b), 0n) === 10_000n);

  console.log("\n[2] too early: the contract refuses");
  const players = proof.message.players;
  const creators = proof.message.creators;
  const shares = proof.message.shares.map(BigInt);
  const wallet = createWalletClient({ account: admin, chain: hardhat, transport: http(RPC) });
  const submit = () => wallet.writeContract({ address: forgeCoin, abi: coinAbi, functionName: "closeSeason", args: [players, creators, shares, proof.signature] } as never);
  let early = "";
  try { await submit(); } catch (e) { early = (e as Error).message; }
  check("closeSeason before seasonEnd reverts SeasonNotOver", early.includes("SeasonNotOver"));

  console.log("\n[3] 30 days later the admin closes the season");
  await rpc("evm_increaseTime", [30 * 24 * 3600 + 5]);
  await rpc("evm_mine");
  const pool = await read<bigint>("seasonPool");
  const winners = [...players, ...creators];
  const before = await Promise.all(winners.map((a) => read<bigint>("balanceOf", [a])));
  const hash = await submit();
  const receipt = await pub.waitForTransactionReceipt({ hash });
  check("closeSeason succeeds with the server's signature", receipt.status === "success", `gas ${receipt.gasUsed}`);
  let paid = 0n;
  for (let i = 0; i < winners.length; i++) {
    const got = (await read<bigint>("balanceOf", [winners[i]])) - before[i]!;
    const expected = (pool * shares[i]!) / 10_000n;
    paid += got;
    check(`${winners[i]!.slice(0, 8)}… receives ${(Number(shares[i]!) / 100).toFixed(2)}% of the pool`, got === expected, `${fmt(got)} FORGE`);
  }
  check("the season counter moved on", (await read<bigint>("season")) === season + 1n);
  check("only rounding dust stays in the pool", (await read<bigint>("seasonPool")) === pool - paid);

  console.log(failures ? `\nE2E SEASON FLOW FAILED (${failures})` : "\nE2E SEASON FLOW OK");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error("E2E SEASON FLOW FAILED:", e);
  process.exit(1);
});
