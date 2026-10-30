import { randomBytes } from "node:crypto";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { bytesToBigInt, type Address, type Hex } from "viem";
import {
  clearProofTypes,
  forgeCoinDomain,
  levelNftDomain,
  raceResultTypes,
  runResultTypes,
  seasonResultTypes,
  UINT16_MAX,
  UINT32_MAX,
  type ClearProof,
  type RaceResult,
  type RunResult,
  type SeasonResult,
} from "./eip712.js";

export interface SignerOptions {
  privateKey: Hex;
  chainId: number;
  levelNftAddress?: Address;
  forgeCoinAddress?: Address;
  /** Validity window for deadlines, seconds. */
  ttlSec?: number;
}

export interface Signed<T> {
  message: T;
  signature: Hex;
  signer: Address;
}

export class ContractNotConfiguredError extends Error {
  constructor(name: string) {
    super(`${name} address is not configured (set ${name === "LevelNFT" ? "LEVEL_NFT_ADDRESS" : "FORGE_COIN_ADDRESS"})`);
    this.name = "ContractNotConfiguredError";
  }
}

/**
 * Random 256-bit nonce. The contracts track used nonces in a mapping (not a
 * counter), so random nonces avoid server-side state and survive restarts.
 */
export function generateNonce(): bigint {
  return bytesToBigInt(randomBytes(32));
}

/** Unix-seconds deadline `ttlSec` from now. */
export function deadlineFromNow(ttlSec: number, nowMs = Date.now()): bigint {
  return BigInt(Math.floor(nowMs / 1000) + ttlSec);
}

export class GameSigner {
  readonly account: PrivateKeyAccount;
  readonly chainId: number;
  readonly levelNftAddress?: Address;
  readonly forgeCoinAddress?: Address;
  readonly ttlSec: number;

  constructor(opts: SignerOptions) {
    this.account = privateKeyToAccount(opts.privateKey);
    this.chainId = opts.chainId;
    this.levelNftAddress = opts.levelNftAddress;
    this.forgeCoinAddress = opts.forgeCoinAddress;
    this.ttlSec = opts.ttlSec ?? 3600;
  }

  get address(): Address {
    return this.account.address;
  }

  private levelDomain() {
    if (!this.levelNftAddress) throw new ContractNotConfiguredError("LevelNFT");
    return levelNftDomain(this.chainId, this.levelNftAddress);
  }

  private coinDomain() {
    if (!this.forgeCoinAddress) throw new ContractNotConfiguredError("ForgeCoin");
    return forgeCoinDomain(this.chainId, this.forgeCoinAddress);
  }

  async signClearProof(input: { creator: Address; layoutHash: Hex; deadline?: bigint }): Promise<Signed<ClearProof>> {
    const message: ClearProof = {
      creator: input.creator,
      layoutHash: input.layoutHash,
      deadline: input.deadline ?? deadlineFromNow(this.ttlSec),
    };
    const signature = await this.account.signTypedData({
      domain: this.levelDomain(),
      types: clearProofTypes,
      primaryType: "ClearProof",
      message,
    });
    return { message, signature, signer: this.address };
  }

  async signRunResult(
    input: Omit<RunResult, "nonce" | "deadline"> & { nonce?: bigint; deadline?: bigint },
  ): Promise<Signed<RunResult>> {
    if (!Number.isInteger(input.timeMs) || input.timeMs < 0 || input.timeMs > UINT32_MAX) {
      throw new RangeError("timeMs must fit uint32");
    }
    if (!Number.isInteger(input.coins) || input.coins < 0 || input.coins > UINT16_MAX) {
      throw new RangeError("coins must fit uint16");
    }
    const message: RunResult = {
      player: input.player,
      levelId: input.levelId,
      timeMs: input.timeMs,
      cleared: input.cleared,
      coins: input.coins,
      nonce: input.nonce ?? generateNonce(),
      deadline: input.deadline ?? deadlineFromNow(this.ttlSec),
    };
    const signature = await this.account.signTypedData({
      domain: this.coinDomain(),
      types: runResultTypes,
      primaryType: "RunResult",
      message,
    });
    return { message, signature, signer: this.address };
  }

  async signRaceResult(input: { roomId: Hex; ranking: Address[] }): Promise<Signed<RaceResult>> {
    const message: RaceResult = { roomId: input.roomId, ranking: input.ranking };
    const signature = await this.account.signTypedData({
      domain: this.coinDomain(),
      types: raceResultTypes,
      primaryType: "RaceResult",
      message,
    });
    return { message, signature, signer: this.address };
  }

  async signSeasonResult(input: SeasonResult): Promise<Signed<SeasonResult>> {
    if (input.players.length + input.creators.length !== input.shares.length) {
      throw new RangeError("shares length must equal players.length + creators.length");
    }
    const message: SeasonResult = { season: input.season, players: input.players, creators: input.creators, shares: input.shares };
    const signature = await this.account.signTypedData({
      domain: this.coinDomain(),
      types: seasonResultTypes,
      primaryType: "SeasonResult",
      message,
    });
    return { message, signature, signer: this.address };
  }
}
