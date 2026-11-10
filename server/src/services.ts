import { join } from "node:path";
import type { Config } from "./config.js";
import { SiweAuth } from "./auth/siwe.js";
import { openDb, type Db } from "./db.js";
import { LocalPinner, PinataPinner, type Pinner } from "./ipfs.js";
import { LevelRepo } from "./levels.js";
import { GameSigner } from "./signer.js";
import { RunValidator } from "./validation/index.js";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface Services {
  config: Config;
  db: Db;
  signer: GameSigner;
  pinner: Pinner;
  /** Always present: serves /ipfs/:cid for locally stored files (dev). */
  localPinner: LocalPinner;
  levels: LevelRepo;
  validator: RunValidator;
  /** SIWE nonces + session tokens (wallet ownership proof for rooms). */
  sessions: SiweAuth;
  relayer?: ReturnType<typeof privateKeyToAccount>;
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
        realmBadgesAddress: config.REALM_BADGES_ADDRESS,
        levelBountyAddress: config.LEVEL_BOUNTY_ADDRESS,
        ttlSec: config.SIGNATURE_TTL_SEC,
      }),
    pinner: overrides.pinner ?? (config.PINATA_JWT ? new PinataPinner(config.PINATA_JWT) : localPinner),
    localPinner,
    levels: overrides.levels ?? new LevelRepo(db),
    validator: overrides.validator ?? new RunValidator(),
    sessions:
      overrides.sessions ??
      new SiweAuth({ chainId: config.CHAIN_ID, secret: config.SESSION_SECRET, ttlSec: config.SESSION_TTL_SEC, domains: config.SIWE_DOMAINS }),
    relayer: config.RELAYER_PRIVATE_KEY ? privateKeyToAccount(config.RELAYER_PRIVATE_KEY as Hex) : undefined,
  };
}
