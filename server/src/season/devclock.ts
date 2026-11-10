import { decodeFunctionResult, encodeFunctionData, parseAbi, type Address } from "viem";

/**
 * LOCAL CHAIN ONLY: moves the Hardhat clock to the end of the running ForgeCoin season (`evm_increaseTime` +
 * `evm_mine`) so the demo can close a season without waiting 30 days. Refuses any chain other than Hardhat (31337):
 * those JSON-RPC methods do not exist on Sepolia, and the check makes the intent explicit.
 * Used by `server/scripts/season-fast-forward.ts` (`npm run season:ff` at the root).
 */
export const HARDHAT_CHAIN_ID = 31337;

const abi = parseAbi(["function seasonEnd() view returns (uint256)", "function season() view returns (uint256)"]);

/** Seconds to add to a chain at `chainNow` so the next block is at `seasonEnd - leave` (0 if already there). */
export function secondsToSkip(chainNow: bigint, seasonEnd: bigint, leave = 0n): bigint {
  const target = seasonEnd - leave;
  return target > chainNow ? target - chainNow : 0n;
}

export interface FastForwardResult {
  season: bigint;
  seasonEnd: bigint;
  before: bigint;
  after: bigint;
  skipped: bigint;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ json(): Promise<unknown> }>;

export async function fastForwardSeason(opts: { rpcUrl: string; forgeCoin: Address; leaveSeconds?: number; fetch?: Fetch }): Promise<FastForwardResult> {
  const f: Fetch = opts.fetch ?? (globalThis.fetch as unknown as Fetch);
  let id = 0;
  const rpc = async <T>(method: string, params: unknown[] = []): Promise<T> => {
    const res = (await (await f(opts.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) })).json()) as {
      result?: T;
      error?: { message: string };
    };
    if (res.error) throw new Error(`${method}: ${res.error.message}`);
    return res.result as T;
  };
  const read = async (functionName: "seasonEnd" | "season") =>
    decodeFunctionResult({ abi, functionName, data: await rpc<`0x${string}`>("eth_call", [{ to: opts.forgeCoin, data: encodeFunctionData({ abi, functionName }) }, "latest"]) });
  const now = async () => BigInt((await rpc<{ timestamp: string }>("eth_getBlockByNumber", ["latest", false])).timestamp);

  const chainId = Number(BigInt(await rpc<string>("eth_chainId")));
  if (chainId !== HARDHAT_CHAIN_ID) throw new Error(`refusing to touch the clock of chain ${chainId}: local Hardhat (${HARDHAT_CHAIN_ID}) only`);

  const [season, seasonEnd, before] = [await read("season"), await read("seasonEnd"), await now()];
  const skipped = secondsToSkip(before, seasonEnd, BigInt(opts.leaveSeconds ?? 0));
  if (skipped > 0n) await rpc("evm_increaseTime", [Number(skipped)]);
  await rpc("evm_mine");
  return { season, seasonEnd, before, after: await now(), skipped };
}
