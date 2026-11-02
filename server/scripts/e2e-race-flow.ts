/**
 * Scripted race flow against the local stack (npm run dev:chain + deploy:local, level #1 published, e.g. by
 * `npm run e2e:chain`): escrow → server-signed RaceResult (same GameSigner as the rooms) → settleRace payout,
 * an expired result that must be refused, and the refund path after the timeout.
 *
 * Run: `npx tsx scripts/e2e-race-flow.ts` in server/. Uses Hardhat's unlocked accounts #4 and #5 as racers and #6
 * as the relayer (local chain only). Expects the amounts of docs/DEMO.md step 11.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, formatUnits, http, keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import { hardhat } from "viem/chains";
import { GameSigner } from "../src/signer.js";

const HERE = dirname(fileURLToPath(import.meta.url));
process.loadEnvFile?.(resolve(HERE, "../.env"));
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const forgeCoin = process.env.FORGE_COIN_ADDRESS as Address;
const levelNFT = process.env.LEVEL_NFT_ADDRESS as Address;
if (!forgeCoin || !levelNFT) throw new Error("FORGE_COIN_ADDRESS / LEVEL_NFT_ADDRESS missing (run npm run deploy:local)");
const coinAbi = JSON.parse(readFileSync(resolve(HERE, "../abi/ForgeCoin.json"), "utf8")).abi;
const levelAbi = JSON.parse(readFileSync(resolve(HERE, "../abi/LevelNFT.json"), "utf8")).abi;

const pub = createPublicClient({ chain: hardhat, transport: http(RPC) });
const rpc = (method: string, params: unknown[] = []) =>
  fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }).then((r) => r.json());
const accounts = ((await rpc("eth_accounts")) as { result: Address[] }).result;
const [racer1, racer2, relayer] = [accounts[4]!, accounts[5]!, accounts[6]!];
const wallet = (account: Address) => createWalletClient({ account, chain: hardhat, transport: http(RPC) });

const signer = new GameSigner({ privateKey: process.env.SIGNER_PRIVATE_KEY as Hex, chainId: 31337, forgeCoinAddress: forgeCoin, levelNftAddress: levelNFT, ttlSec: 3600 });
const fmt = (v: bigint) => formatUnits(v, 18);
const balance = (a: Address) => pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
};

async function send(account: Address, functionName: string, args: unknown[]) {
  const hash = await wallet(account).writeContract({ address: forgeCoin, abi: coinAbi, functionName, args } as never);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted`);
  return receipt;
}
const reverts = async (account: Address, functionName: string, args: unknown[], name: string) => {
  try {
    await wallet(account).writeContract({ address: forgeCoin, abi: coinAbi, functionName, args } as never);
    return false;
  } catch (e) {
    return String((e as Error).message).includes(name);
  }
};

async function main() {
  const nextId = (await pub.readContract({ address: levelNFT, abi: levelAbi, functionName: "nextId" })) as bigint;
  if (nextId < 2n) throw new Error("no published level: run `npm run e2e:chain` first");
  const levelId = 1n;
  const [levelOwner] = (await pub.readContract({ address: levelNFT, abi: levelAbi, functionName: "levelInfo", args: [levelId] })) as [Address];
  const stake = parseUnits("10", 18);

  console.log("\n[1] faucet for the racers");
  for (const a of [racer1, racer2]) {
    const claimed = (await pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "faucetClaimed", args: [a] })) as boolean;
    if (!claimed) await send(a, "claimFaucet", []);
  }
  const start = { r1: await balance(racer1), r2: await balance(racer2), owner: await balance(levelOwner) };
  const poolBefore = (await pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "seasonPool" })) as bigint;

  console.log("\n[2] 1v1 race: escrow, server-signed ranking, payout");
  const raceId = keccak256(toHex(`E2E-${Date.now()}`)); // the room code → id rule of the server
  await send(racer1, "createRaceRoom", [raceId, levelId, stake]);
  await send(racer2, "joinRace", [raceId]);
  check("escrow holds both stakes", (await balance(forgeCoin)) >= stake * 2n);
  const signed = await signer.signRaceResult({ roomId: raceId, ranking: [racer2, racer1] }); // racer2 wins
  await send(relayer, "settleRace", [raceId, [racer2, racer1], signed.message.deadline, signed.signature]); // anyone can submit
  const d = async (a: Address, before: bigint) => fmt((await balance(a)) - before);
  check("winner gets 60% of the 20 pot net of their stake (+2)", (await d(racer2, start.r2)) === "2", `stake 10 in, 12 out → +${await d(racer2, start.r2)}`);
  check("second gets 25% (5), net -5", (await d(racer1, start.r1)) === "-5", `${await d(racer1, start.r1)}`);
  check("level owner gets 10% (2)", (await d(levelOwner, start.owner)) === "2");
  const poolAfter = (await pub.readContract({ address: forgeCoin, abi: coinAbi, functionName: "seasonPool" })) as bigint;
  check("season pool gets 5% (1)", fmt(poolAfter - poolBefore) === "1");
  check("settling twice is refused", await reverts(relayer, "settleRace", [raceId, [racer2, racer1], signed.message.deadline, signed.signature], "RaceNotOpen"));

  console.log("\n[3] an expired signed result is refused, the room is refunded after the timeout");
  const room2 = keccak256(toHex(`E2E-expired-${Date.now()}`));
  const before2 = { r1: await balance(racer1), r2: await balance(racer2) };
  await send(racer1, "createRaceRoom", [room2, levelId, stake]);
  await send(racer2, "joinRace", [room2]);
  const latest = await pub.getBlock();
  const expired = await signer.signRaceResult({ roomId: room2, ranking: [racer1, racer2], deadline: latest.timestamp - 10n });
  check("settleRace with a past deadline reverts SignatureExpired", await reverts(relayer, "settleRace", [room2, [racer1, racer2], expired.message.deadline, expired.signature], "SignatureExpired"));
  check("refund before the timeout reverts", await reverts(relayer, "refundRace", [room2], "RaceNotTimedOut"));
  await rpc("evm_increaseTime", [3601]);
  await rpc("evm_mine");
  await send(relayer, "refundRace", [room2]);
  check("both stakes are back after the refund", (await balance(racer1)) === before2.r1 && (await balance(racer2)) === before2.r2);

  console.log(failures ? `\nE2E RACE FLOW FAILED (${failures})` : "\nE2E RACE FLOW OK");
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error("E2E RACE FLOW FAILED:", e);
  process.exit(1);
});
