#!/usr/bin/env node
/**
 * npm run deploy:local — deploy RealmForge to a running `npm run dev:chain` (Hardhat node, chain 31337):
 *   1. hardhat build + Ignition deploy (signer = Hardhat account #1, the server's PUBLIC dev key)
 *   2. export ABIs → web/src/contracts/generated and server/abi
 *   3. write web/.env.local and server/.env with the deployed addresses
 * Local dev only: the keys involved are Hardhat's well-known test keys.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = join(ROOT, "contracts");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const run = (cmd, cwd = C) => {
  console.log(`\n$ ${cmd}   (${cwd.replace(ROOT + "/", "")})`);
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, CI: "true" } });
};

// 0. chain reachable?
const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) }).catch(() => null);
if (!res?.ok) {
  console.error(`No JSON-RPC node at ${RPC}. Start it first: npm run dev:chain`);
  process.exit(1);
}
const chainId = parseInt((await res.json()).result, 16);
if (chainId !== 31337) throw new Error(`expected chain 31337, got ${chainId}`);

// 1. a fresh Hardhat node has no contracts: drop stale Ignition state for 31337, then deploy
const dep = join(C, "ignition", "deployments", "chain-31337");
if (existsSync(dep)) rmSync(dep, { recursive: true, force: true });
run("npx hardhat build");
run("npx hardhat ignition deploy ignition/modules/RealmForge.ts --network localhost --parameters ignition/parameters/localhost.json");

const deployed = JSON.parse(readFileSync(join(dep, "deployed_addresses.json"), "utf8"));
const levelNFT = deployed["RealmForgeModule#LevelNFT"];
const forgeCoin = deployed["RealmForgeModule#ForgeCoin"];
if (!levelNFT || !forgeCoin) throw new Error("deployment addresses not found");

// 2. ABIs
run("node scripts/export-abi.ts");
run("node scripts/export-abi.ts --out ../server/abi");
for (const f of readdirSync(join(ROOT, "server", "abi"))) if (f.endsWith(".abi.ts") || f === "addresses.json") rmSync(join(ROOT, "server", "abi", f)); // server only reads *.json

// 3. env files (from the committed examples)
const setEnv = (text, values) => {
  let out = text;
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    out = re.test(out) ? out.replace(re, `${k}=${v}`) : `${out.trimEnd()}\n${k}=${v}\n`;
  }
  return out;
};
const webEnv = setEnv(readFileSync(join(ROOT, "web", ".env.example"), "utf8"), {
  VITE_DEFAULT_CHAIN_ID: "31337",
  VITE_LEVEL_NFT_ADDRESS: levelNFT,
  VITE_FORGE_COIN_ADDRESS: forgeCoin,
  VITE_API_URL: "http://localhost:8787",
  VITE_GAME_SERVER_URL: "ws://localhost:2567",
  VITE_IPFS_GATEWAY: "http://localhost:8787/ipfs/",
});
writeFileSync(join(ROOT, "web", ".env.local"), webEnv);
const serverEnv = setEnv(readFileSync(join(ROOT, "server", ".env.example"), "utf8"), {
  RPC_URL: RPC,
  CHAIN_ID: "31337",
  LEVEL_NFT_ADDRESS: levelNFT,
  FORGE_COIN_ADDRESS: forgeCoin,
  INDEXER_START_BLOCK: "0",
  // a fresh chain reuses token ids: keep one SQLite DB per deployment
  DATA_DIR: `./data/local-${levelNFT.slice(2, 10).toLowerCase()}`,
});
writeFileSync(join(ROOT, "server", ".env"), serverEnv);

console.log(`\nDeployed on chain ${chainId}:\n  LevelNFT  ${levelNFT}\n  ForgeCoin ${forgeCoin}\nWrote web/.env.local and server/.env. Next: npm run dev:server · npm run dev:web`);
