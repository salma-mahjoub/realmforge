import { join } from "node:path";
import type { Config } from "./config.js";
import { openDb, type Db } from "./db.js";
import { LocalPinner, PinataPinner, type Pinner } from "./ipfs.js";
import { LevelRepo } from "./levels.js";
import { GameSigner } from "./signer.js";
import { RunValidator } from "./validation/index.js";

export interface Services {
  config: Config;
  db: Db;
  signer: GameSigner;
  pinner: Pinner;
  /** Always present: serves /ipfs/:cid for locally stored files (dev). */
  localPinner: LocalPinner;
  levels: LevelRepo;
  validator: RunValidator;
}

export function createServices(config: Config, overrides: Partial<Services> = {}): Services {
  const db = overrides.db ?? openDb(config.DATA_DIR === ":memory:" ? ":memory:" : join(config.DATA_DIR, "realmforge.sqlite"));
  const localPinner =
    overrides.localPinner ?? new LocalPinner(join(config.DATA_DIR === ":memory:" ? "./data" : config.DATA_DIR, "ipfs"));
  return {
    config,
    db,
    signer:
      overrides.signer ??
      new GameSigner({
        privateKey: config.SIGNER_PRIVATE_KEY,
        chainId: config.CHAIN_ID,
        levelNftAddress: config.LEVEL_NFT_ADDRESS,
        forgeCoinAddress: config.FORGE_COIN_ADDRESS,
        ttlSec: config.SIGNATURE_TTL_SEC,
      }),
    pinner: overrides.pinner ?? (config.PINATA_JWT ? new PinataPinner(config.PINATA_JWT) : localPinner),
    localPinner,
    levels: overrides.levels ?? new LevelRepo(db),
    validator: overrides.validator ?? new RunValidator(),
  };
}
