/**
 * LOCAL CHAIN ONLY — demo helper: jump the Hardhat clock to the end of the running ForgeCoin season so the admin
 * can close it from the Season page (or `npm run e2e:season`) without waiting 30 days. Refuses any chain but 31337.
 *
 *   npm run season:ff                       # at the repo root: next block is at seasonEnd → "Close season" unlocks
 *   LEAVE_SECONDS=90 npm run season:ff      # stop 90 s before the end, to show the countdown reaching zero
 *
 * Reads RPC_URL and FORGE_COIN_ADDRESS from the environment or server/.env (written by `npm run deploy:local`).
 * Note: the browser countdown uses the wall clock while the contract uses block time. The page reads the latest
 * block timestamp, so after a fast-forward the countdown follows the chain.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address } from "viem";
import { fastForwardSeason } from "../src/season/devclock.js";

const HERE = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile?.(resolve(HERE, "../.env"));
} catch {
  /* no server/.env: rely on the environment */
}
const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const forgeCoin = process.env.FORGE_COIN_ADDRESS as Address | undefined;
if (!forgeCoin) {
  console.error("FORGE_COIN_ADDRESS is not set (run `npm run deploy:local` first or export it).");
  process.exit(1);
}

const r = await fastForwardSeason({ rpcUrl, forgeCoin, leaveSeconds: Number(process.env.LEAVE_SECONDS ?? 0) });
const iso = (t: bigint) => new Date(Number(t) * 1000).toISOString();
console.log(`season ${r.season} ends at ${iso(r.seasonEnd)}`);
console.log(`chain clock: ${iso(r.before)} → ${iso(r.after)} (+${r.skipped}s)`);
console.log(r.after >= r.seasonEnd ? "season is over: the admin can now call closeSeason" : `${r.seasonEnd - r.after}s left in the season`);
