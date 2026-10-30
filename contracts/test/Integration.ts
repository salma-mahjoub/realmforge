/**
 * Integration tests (TypeScript, node:test + viem) — `npx hardhat test nodejs`.
 *
 * Deploys through the real Ignition module (SPEC §6 order) and signs EIP-712 messages exactly like the
 * server (`signTypedData`) and the web app (ERC-2612 permit) will. If these pass, the type strings in
 * contracts/README.md are correct for viem.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { keccak256, parseEther, parseSignature, stringToHex, type Address } from "viem";

import RealmForgeModule from "../ignition/modules/RealmForge.js";

const { viem, ignition } = await network.create();

// ---- EIP-712 types (must match contracts/README.md, server/ and web/) ----
const CLEAR_PROOF_TYPES = {
  ClearProof: [
    { name: "creator", type: "address" },
    { name: "layoutHash", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const RUN_RESULT_TYPES = {
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

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

async function deploy() {
  const [deployer, server, creator, player, buyer, permitPlayer] = await viem.getWalletClients();
  const { forgeCoin, levelNFT } = await ignition.deploy(RealmForgeModule, {
    parameters: { RealmForgeModule: { signer: server.account.address } },
  });
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const now = (await publicClient.getBlock()).timestamp;

  const nftDomain = {
    name: "RealmForge LevelNFT",
    version: "1",
    chainId,
    verifyingContract: levelNFT.address,
  } as const;
  const coinDomain = {
    name: "RealmForge ForgeCoin",
    version: "1",
    chainId,
    verifyingContract: forgeCoin.address,
  } as const;

  async function signClearProof(creatorAddr: Address, layoutHash: `0x${string}`, deadline: bigint) {
    return server.signTypedData({
      domain: nftDomain,
      types: CLEAR_PROOF_TYPES,
      primaryType: "ClearProof",
      message: { creator: creatorAddr, layoutHash, deadline },
    });
  }

  function runResult(p: Address, levelId: bigint, nonce: bigint, cleared = true, timeMs = 12_000) {
    return { player: p, levelId, timeMs, cleared, coins: 3, nonce, deadline: now + 3600n };
  }

  async function signRun(r: ReturnType<typeof runResult>) {
    return server.signTypedData({ domain: coinDomain, types: RUN_RESULT_TYPES, primaryType: "RunResult", message: r });
  }

  return {
    deployer, server, creator, player, buyer, permitPlayer,
    forgeCoin, levelNFT, publicClient, now, coinDomain,
    signClearProof, runResult, signRun,
  };
}

describe("RealmForge integration", async () => {
  it("Ignition module deploys, links and grants GAME_ROLE (SPEC §6)", async () => {
    const { forgeCoin, levelNFT, server } = await deploy();
    assert.equal((await forgeCoin.read.levelNFT()).toLowerCase(), levelNFT.address.toLowerCase());
    assert.equal((await forgeCoin.read.signer()).toLowerCase(), server.account.address.toLowerCase());
    const gameRole = await levelNFT.read.GAME_ROLE();
    assert.equal(await levelNFT.read.hasRole([gameRole, forgeCoin.address]), true);
    const signerRole = await levelNFT.read.SIGNER_ROLE();
    assert.equal(await levelNFT.read.hasRole([signerRole, server.account.address]), true);
  });

  it("publish → settleRun → recordRun → buy NFT → new owner receives the fees", async () => {
    const ctx = await deploy();
    const { forgeCoin, levelNFT, creator, player, buyer, now } = ctx;

    // 1. creator publishes level #1 with a server-signed ClearProof
    const layoutHash = keccak256(stringToHex('{"v":1,"tiles":[]}'));
    const deadline = now + 3600n;
    const clearSig = await ctx.signClearProof(creator.account.address, layoutHash, deadline);
    await levelNFT.write.publish([layoutHash, "ipfs://bafy-test", parseEther("10"), 0n, deadline, clearSig], {
      account: creator.account,
    });
    assert.equal((await levelNFT.read.ownerOf([1n])).toLowerCase(), creator.account.address.toLowerCase());

    // 2. player gets faucet FORGE, approves, settles a signed run
    await forgeCoin.write.claimFaucet({ account: player.account });
    await forgeCoin.write.approve([forgeCoin.address, parseEther("1000")], { account: player.account });
    const r1 = ctx.runResult(player.account.address, 1n, 1n);
    await forgeCoin.write.settleRun([r1, await ctx.signRun(r1)], { account: player.account });

    // 3. recordRun was called by ForgeCoin
    const lvl = await levelNFT.read.levels([1n]);
    assert.equal(lvl[4], 1); // plays
    assert.equal(lvl[5], 1); // clears
    assert.equal(lvl[7], 12_000); // bestTimeMs
    assert.equal(await forgeCoin.read.balanceOf([creator.account.address]), parseEther("7")); // 70%
    assert.equal(await forgeCoin.read.seasonPool(), parseEther("2"));
    assert.equal(await forgeCoin.read.treasuryBalance(), parseEther("1"));

    // replaying the same signed run fails
    await assert.rejects(
      forgeCoin.write.settleRun([r1, await ctx.signRun(r1)], { account: player.account }),
      /NonceAlreadyUsed/,
    );

    // 4. creator sells the NFT
    await levelNFT.write.list([1n, parseEther("1")], { account: creator.account });
    await levelNFT.write.buy([1n], { account: buyer.account, value: parseEther("1") });
    assert.equal((await levelNFT.read.ownerOf([1n])).toLowerCase(), buyer.account.address.toLowerCase());
    assert.equal(await levelNFT.read.pendingWithdrawals([creator.account.address]), parseEther("1"));

    // 5. next run: the NEW owner receives the 70%
    const r2 = ctx.runResult(player.account.address, 1n, 2n, true, 11_000);
    await forgeCoin.write.settleRun([r2, await ctx.signRun(r2)], { account: player.account });
    assert.equal(await forgeCoin.read.balanceOf([buyer.account.address]), parseEther("7"));
    assert.equal(await forgeCoin.read.balanceOf([creator.account.address]), parseEther("7"));
  });

  it("settleRunWithPermit: ERC-2612 permit + run in one tx (no approve)", async () => {
    const ctx = await deploy();
    const { forgeCoin, levelNFT, creator, permitPlayer, now, coinDomain } = ctx;
    const layoutHash = keccak256(stringToHex("permit-level"));
    const clearSig = await ctx.signClearProof(creator.account.address, layoutHash, now + 3600n);
    await levelNFT.write.publish([layoutHash, "ipfs://x", parseEther("5"), 0n, now + 3600n, clearSig], {
      account: creator.account,
    });
    await forgeCoin.write.claimFaucet({ account: permitPlayer.account });

    const permitDeadline = now + 3600n;
    const permitSig = await permitPlayer.signTypedData({
      domain: coinDomain,
      types: PERMIT_TYPES,
      primaryType: "Permit",
      message: {
        owner: permitPlayer.account.address,
        spender: forgeCoin.address,
        value: parseEther("5"),
        nonce: await forgeCoin.read.nonces([permitPlayer.account.address]),
        deadline: permitDeadline,
      },
    });
    const { v, r, s } = parseSignature(permitSig);
    const run = ctx.runResult(permitPlayer.account.address, 1n, 1n, false);
    await forgeCoin.write.settleRunWithPermit([run, await ctx.signRun(run), Number(v), r, s, permitDeadline], {
      account: permitPlayer.account,
    });
    assert.equal(await forgeCoin.read.balanceOf([permitPlayer.account.address]), parseEther("95"));
    assert.equal(await forgeCoin.read.balanceOf([creator.account.address]), parseEther("3.5"));
  });

  it("a ClearProof signed for another chain/contract is rejected", async () => {
    const ctx = await deploy();
    const { levelNFT, creator, server, now } = ctx;
    const layoutHash = keccak256(stringToHex("wrong-domain"));
    const badSig = await server.signTypedData({
      domain: { name: "RealmForge LevelNFT", version: "1", chainId: 1, verifyingContract: levelNFT.address },
      types: CLEAR_PROOF_TYPES,
      primaryType: "ClearProof",
      message: { creator: creator.account.address, layoutHash, deadline: now + 3600n },
    });
    await assert.rejects(
      levelNFT.write.publish([layoutHash, "ipfs://x", 0n, 0n, now + 3600n, badSig], { account: creator.account }),
      /InvalidSigner/,
    );
  });

  // ---------------------------------------------------------------- SPEC §11 backlog (students)
  it.todo("[A] publish: remix of a remix → royalty split goes to the right ancestors");
  it.todo("[A] withdraw: reentrancy attack by a malicious receiver contract fails");
  it.todo("[A] setActive(false) → ForgeCoin.settleRun reverts LevelInactive (integration)");
  it.todo("[B] closeSeason: distributes pool to top 10 players + top 10 creators, season++");
  it.todo("[B] closeSeason: reverts before seasonEnd, bad shares, wrong signer");
  it.todo("[B] settleRace: 4 players, outsider in ranking reverts, duplicate rank reverts");
  it.todo("[B] reward clipping at token cap (totalSupply == cap)");
  it.todo("[A+B] gas report: publish, settleRun, buy, settleRace (npx hardhat test --gas-stats)");
  it.todo("[A+B] Slither static analysis report (docs/)");
});
