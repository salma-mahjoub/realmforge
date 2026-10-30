/**
 * EIP-712 domains and typed-data definitions used by the game server signer.
 *
 * !!! These MUST match the Solidity structs/typehashes in contracts/ byte-for-byte
 * !!! (struct name, field names, field order and Solidity types). Any mismatch makes
 * !!! every signature invalid on-chain. contracts/ is written concurrently by another
 * !!! agent with the same names; reconcile against contracts/README.md and the
 * !!! *_TYPEHASH constants in contracts/src whenever either side changes.
 *
 * Reconciled against contracts/src on 2026-10-30:
 *   LevelNFT.sol  CLEAR_PROOF_TYPEHASH   ClearProof(address creator,bytes32 layoutHash,uint256 deadline)
 *                 EIP712("RealmForge LevelNFT", "1")
 *   ForgeCoin.sol RUN_RESULT_TYPEHASH    RunResult(address player,uint256 levelId,uint32 timeMs,bool cleared,uint16 coins,uint256 nonce,uint256 deadline)
 *                 RACE_RESULT_TYPEHASH   RaceResult(bytes32 roomId,address[] ranking)
 *                 SEASON_RESULT_TYPEHASH SeasonResult(uint256 season,address[] players,address[] creators,uint256[] shares)
 *                 ERC20Permit("RealmForge ForgeCoin") -> EIP712 name "RealmForge ForgeCoin", version "1"
 *
 * NOTE: the original server brief had RaceResult carry `nonce, deadline`; the contract
 * does not (replay is prevented because a race room can be settled only once, and a
 * season only once per `season` value), so the server follows the contract.
 */
import type { Address, Hex, TypedDataDomain } from "viem";

export const LEVEL_NFT_DOMAIN_NAME = "RealmForge LevelNFT";
export const FORGE_COIN_DOMAIN_NAME = "RealmForge ForgeCoin";
export const DOMAIN_VERSION = "1";

export function levelNftDomain(chainId: number, verifyingContract: Address) {
  return {
    name: LEVEL_NFT_DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const satisfies TypedDataDomain;
}

export function forgeCoinDomain(chainId: number, verifyingContract: Address) {
  return {
    name: FORGE_COIN_DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract,
  } as const satisfies TypedDataDomain;
}

export const clearProofTypes = {
  ClearProof: [
    { name: "creator", type: "address" },
    { name: "layoutHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const runResultTypes = {
  RunResult: [
    { name: "player", type: "address" },
    { name: "levelId", type: "uint256" },
    { name: "timeMs", type: "uint32" },
    { name: "cleared", type: "bool" },
    { name: "coins", type: "uint16" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const raceResultTypes = {
  RaceResult: [
    { name: "roomId", type: "bytes32" },
    { name: "ranking", type: "address[]" },
  ],
} as const;

/** Season settlement (SPEC §5.3 closeSeason). `season` is ForgeCoin.season() at signing time. */
export const seasonResultTypes = {
  SeasonResult: [
    { name: "season", type: "uint256" },
    { name: "players", type: "address[]" },
    { name: "creators", type: "address[]" },
    { name: "shares", type: "uint256[]" },
  ],
} as const;

export interface ClearProof {
  creator: Address;
  layoutHash: Hex;
  deadline: bigint;
}

export interface RunResult {
  player: Address;
  levelId: bigint;
  /** uint32 — max 4_294_967_295 ms (~49 days) */
  timeMs: number;
  cleared: boolean;
  /** uint16 — max 65_535 */
  coins: number;
  nonce: bigint;
  deadline: bigint;
}

export interface RaceResult {
  roomId: Hex;
  ranking: Address[];
}

export interface SeasonResult {
  season: bigint;
  players: Address[];
  creators: Address[];
  shares: bigint[];
}

export const UINT32_MAX = 2 ** 32 - 1;
export const UINT16_MAX = 2 ** 16 - 1;

/** JSON-safe view of a typed-data message (bigints -> decimal strings). */
export function toJsonSafe<T extends object>(msg: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(msg, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
