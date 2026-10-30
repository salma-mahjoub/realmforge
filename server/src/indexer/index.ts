import { createPublicClient, http, type Abi, type Address, type PublicClient, type WatchContractEventReturnType } from "viem";
import type { Db } from "../db.js";
import { loadAbi } from "./abi.js";
import { applyLog, type DecodedLog } from "./handlers.js";

export { applyLog } from "./handlers.js";
export { loadAbi } from "./abi.js";

export interface IndexerOptions {
  db: Db;
  rpcUrl: string;
  chainId: number;
  contracts: { name: "LevelNFT" | "ForgeCoin"; address: Address }[];
  startBlock?: bigint;
  /** Max blocks per getContractEvents call during backfill. */
  chunkSize?: bigint;
  pollingIntervalMs?: number;
  log?: (msg: string, extra?: unknown) => void;
}

/**
 * Event indexer (SPEC §7): backfills from the last processed block, then follows the
 * chain with viem `watchContractEvent`, writing to SQLite via `applyLog`.
 */
export class Indexer {
  private client: PublicClient;
  private unwatch: WatchContractEventReturnType[] = [];
  private readonly abis = new Map<string, Abi>();

  constructor(private readonly opts: IndexerOptions) {
    this.client = createPublicClient({
      transport: http(opts.rpcUrl),
      pollingInterval: opts.pollingIntervalMs ?? 2_000,
    }) as PublicClient;
    for (const c of opts.contracts) this.abis.set(c.name, loadAbi(c.name));
  }

  private stateKey(addr: Address) {
    return `lastBlock:${this.opts.chainId}:${addr.toLowerCase()}`;
  }

  private getLastBlock(addr: Address): bigint | undefined {
    const row = this.opts.db.prepare("SELECT value FROM indexer_state WHERE key = ?").get(this.stateKey(addr)) as
      | { value: string }
      | undefined;
    return row ? BigInt(row.value) : undefined;
  }

  private setLastBlock(addr: Address, block: bigint) {
    this.opts.db
      .prepare("INSERT INTO indexer_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(this.stateKey(addr), block.toString());
  }

  private handle(addr: Address, logs: readonly unknown[]) {
    let maxBlock = 0n;
    for (const raw of logs) {
      const log = raw as DecodedLog;
      try {
        applyLog(this.opts.db, log);
      } catch (err) {
        this.opts.log?.("indexer: failed to apply log", { err, event: log.eventName, tx: log.transactionHash });
      }
      if (log.blockNumber && log.blockNumber > maxBlock) maxBlock = log.blockNumber;
    }
    if (maxBlock > 0n) this.setLastBlock(addr, maxBlock);
  }

  async start(): Promise<void> {
    const chainId = await this.client.getChainId();
    if (chainId !== this.opts.chainId) {
      throw new Error(`RPC chainId ${chainId} != configured CHAIN_ID ${this.opts.chainId}`);
    }
    const head = await this.client.getBlockNumber();
    const chunk = this.opts.chunkSize ?? 2_000n;

    for (const { name, address } of this.opts.contracts) {
      const abi = this.abis.get(name)!;
      let from = (this.getLastBlock(address) ?? (this.opts.startBlock ?? 0n) - 1n) + 1n;
      if (from < 0n) from = 0n;
      while (from <= head) {
        const to = from + chunk - 1n < head ? from + chunk - 1n : head;
        const logs = await this.client.getContractEvents({ address, abi, fromBlock: from, toBlock: to });
        this.handle(address, logs);
        this.setLastBlock(address, to);
        from = to + 1n;
      }
      this.opts.log?.(`indexer: ${name}@${address} backfilled to block ${head}`);

      this.unwatch.push(
        this.client.watchContractEvent({
          address,
          abi,
          onLogs: (logs) => this.handle(address, logs),
          onError: (err) => this.opts.log?.(`indexer: watch error (${name})`, err),
        }),
      );
    }
  }

  stop(): void {
    for (const u of this.unwatch) u();
    this.unwatch = [];
  }
}
