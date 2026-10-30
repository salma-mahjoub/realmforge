import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress, verifyTypedData, keccak256, toHex } from "viem";
import {
  clearProofTypes,
  forgeCoinDomain,
  levelNftDomain,
  raceResultTypes,
  runResultTypes,
  seasonResultTypes,
} from "../src/eip712.js";
import { GameSigner, generateNonce, ContractNotConfiguredError } from "../src/signer.js";
import { FORGE_COIN, LEVEL_NFT, PLAYER, TEST_KEY, TEST_SIGNER } from "./helpers.js";

const signer = new GameSigner({ privateKey: TEST_KEY, chainId: 31337, levelNftAddress: LEVEL_NFT, forgeCoinAddress: FORGE_COIN });

describe("GameSigner (EIP-712)", () => {
  it("derives the expected signer address", () => {
    expect(signer.address).toBe(TEST_SIGNER);
  });

  it("ClearProof signature verifies against the LevelNFT domain", async () => {
    const layoutHash = keccak256(toHex("level"));
    const { message, signature } = await signer.signClearProof({ creator: PLAYER, layoutHash });
    expect(message.deadline).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
    const ok = await verifyTypedData({
      address: TEST_SIGNER,
      domain: levelNftDomain(31337, LEVEL_NFT),
      types: clearProofTypes,
      primaryType: "ClearProof",
      message,
      signature,
    });
    expect(ok).toBe(true);
    // Bound to chain id: a different chain must not verify.
    const wrongChain = await verifyTypedData({
      address: TEST_SIGNER,
      domain: levelNftDomain(1, LEVEL_NFT),
      types: clearProofTypes,
      primaryType: "ClearProof",
      message,
      signature,
    });
    expect(wrongChain).toBe(false);
  });

  it("RunResult signature recovers to the signer address", async () => {
    const { message, signature } = await signer.signRunResult({ player: PLAYER, levelId: 7n, timeMs: 12_345, cleared: true, coins: 3 });
    const recovered = await recoverTypedDataAddress({
      domain: forgeCoinDomain(31337, FORGE_COIN),
      types: runResultTypes,
      primaryType: "RunResult",
      message,
      signature,
    });
    expect(recovered).toBe(TEST_SIGNER);
    const ok = await verifyTypedData({
      address: TEST_SIGNER,
      domain: forgeCoinDomain(31337, FORGE_COIN),
      types: runResultTypes,
      primaryType: "RunResult",
      message: { ...message, timeMs: 1 }, // tampered
      signature,
    });
    expect(ok).toBe(false);
  });

  it("RaceResult and SeasonResult signatures verify", async () => {
    const race = await signer.signRaceResult({ roomId: keccak256(toHex("room")), ranking: [PLAYER, TEST_SIGNER] });
    expect(
      await verifyTypedData({
        address: TEST_SIGNER,
        domain: forgeCoinDomain(31337, FORGE_COIN),
        types: raceResultTypes,
        primaryType: "RaceResult",
        message: race.message,
        signature: race.signature,
      }),
    ).toBe(true);
    const season = await signer.signSeasonResult({ season: 1n, players: [PLAYER], creators: [TEST_SIGNER], shares: [60n, 40n] });
    expect(
      await verifyTypedData({
        address: TEST_SIGNER,
        domain: forgeCoinDomain(31337, FORGE_COIN),
        types: seasonResultTypes,
        primaryType: "SeasonResult",
        message: season.message,
        signature: season.signature,
      }),
    ).toBe(true);
  });

  it("rejects out-of-range uint32/uint16 fields and missing contract addresses", async () => {
    await expect(signer.signRunResult({ player: PLAYER, levelId: 1n, timeMs: 2 ** 32, cleared: true, coins: 0 })).rejects.toThrow(RangeError);
    await expect(signer.signRunResult({ player: PLAYER, levelId: 1n, timeMs: 1, cleared: true, coins: 70_000 })).rejects.toThrow(RangeError);
    const bare = new GameSigner({ privateKey: TEST_KEY, chainId: 31337 });
    await expect(bare.signClearProof({ creator: PLAYER, layoutHash: keccak256("0x00") })).rejects.toThrow(ContractNotConfiguredError);
  });

  it("generates unique 256-bit nonces", () => {
    const set = new Set(Array.from({ length: 100 }, () => generateNonce()));
    expect(set.size).toBe(100);
  });
});
