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

const { viem, ignition, networkHelpers } = await network.create();

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

const RACE_RESULT_TYPES = {
  RaceResult: [
    { name: "roomId", type: "bytes32" },
    { name: "ranking", type: "address[]" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const SEASON_RESULT_TYPES = {
  SeasonResult: [
    { name: "season", type: "uint256" },
    { name: "players", type: "address[]" },
    { name: "creators", type: "address[]" },
    { name: "shares", type: "uint256[]" },
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
  const wallets = await viem.getWalletClients();
  const [deployer, server, creator, player, buyer, permitPlayer] = wallets;
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

  async function signRace(roomId: `0x${string}`, ranking: Address[], deadline: bigint, signer = server) {
    return signer.signTypedData({
      domain: coinDomain,
      types: RACE_RESULT_TYPES,
      primaryType: "RaceResult",
      message: { roomId, ranking, deadline },
    });
  }

  async function signSeason(
    season: bigint, players: Address[], creators: Address[], shares: bigint[], signer = server,
  ) {
    return signer.signTypedData({
      domain: coinDomain,
      types: SEASON_RESULT_TYPES,
      primaryType: "SeasonResult",
      message: { season, players, creators, shares },
    });
  }

  /** `creator` publishes a level with the given play fee; returns its id (always 1 on a fresh deploy). */
  async function publishLevel(label: string, playFee: bigint) {
    const layoutHash = keccak256(stringToHex(label));
    const sig = await signClearProof(creator.account.address, layoutHash, now + 3600n);
    await levelNFT.write.publish([layoutHash, `ipfs://${label}`, playFee, 0n, now + 3600n, sig], {
      account: creator.account,
    });
    return 1n;
  }

  return {
    deployer, server, creator, player, buyer, permitPlayer, wallets,
    forgeCoin, levelNFT, publicClient, now, coinDomain,
    signClearProof, runResult, signRun, signRace, signSeason, publishLevel,
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
    assert.equal(await forgeCoin.read.treasuryBalance(), parseEther("0.5")); // other 0.5 burned

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

  it("setActive(false) on the real LevelNFT → ForgeCoin.settleRun reverts LevelInactive", async () => {
    const ctx = await deploy();
    const { forgeCoin, levelNFT, creator, player } = ctx;
    const id = await ctx.publishLevel("inactive-level", parseEther("10"));
    await forgeCoin.write.claimFaucet({ account: player.account });
    await forgeCoin.write.approve([forgeCoin.address, parseEther("100")], { account: player.account });

    await levelNFT.write.setActive([id, false], { account: creator.account });
    const run = ctx.runResult(player.account.address, id, 1n);
    await assert.rejects(
      forgeCoin.write.settleRun([run, await ctx.signRun(run)], { account: player.account }),
      /LevelInactive/,
    );

    await levelNFT.write.setActive([id, true], { account: creator.account }); // back online: the same run settles
    await forgeCoin.write.settleRun([run, await ctx.signRun(run)], { account: player.account });
    assert.equal((await levelNFT.read.levels([id]))[4], 1); // plays
  });

  it("settleRace: 4 players pay out 60/25/10/5, outsiders and duplicate ranks revert", async () => {
    const ctx = await deploy();
    const { forgeCoin, creator, deployer, wallets, now } = ctx;
    const id = await ctx.publishLevel("race-level", 0n);
    const racers = wallets.slice(6, 10);
    const outsider = wallets[10];
    const roomId = keccak256(stringToHex("room-4p"));
    const stake = parseEther("10");

    for (const w of racers) await forgeCoin.write.claimFaucet({ account: w.account });
    await forgeCoin.write.createRaceRoom([roomId, id, stake], { account: racers[0].account });
    for (const w of racers.slice(1)) await forgeCoin.write.joinRace([roomId], { account: w.account });
    assert.equal(await forgeCoin.read.balanceOf([forgeCoin.address]), parseEther("40")); // escrow

    const deadline = now + 3600n;
    const addr = (w: (typeof racers)[number]) => w.account.address;
    const withOutsider = [addr(racers[3]), addr(outsider)];
    await assert.rejects(
      forgeCoin.write.settleRace([roomId, withOutsider, deadline, await ctx.signRace(roomId, withOutsider, deadline)], {
        account: deployer.account,
      }),
      /InvalidRanking/,
    );
    const duplicate = [addr(racers[3]), addr(racers[3])];
    await assert.rejects(
      forgeCoin.write.settleRace([roomId, duplicate, deadline, await ctx.signRace(roomId, duplicate, deadline)], {
        account: deployer.account,
      }),
      /InvalidRanking/,
    );

    // the room is still open after the failed attempts: a valid ranking settles it (anyone can submit it)
    const ranking = [addr(racers[3]), addr(racers[2]), addr(racers[1]), addr(racers[0])];
    await forgeCoin.write.settleRace([roomId, ranking, deadline, await ctx.signRace(roomId, ranking, deadline)], {
      account: deployer.account,
    });
    const bal = (a: Address) => forgeCoin.read.balanceOf([a]);
    assert.equal(await bal(addr(racers[3])), parseEther("114")); // 90 + 60% of 40
    assert.equal(await bal(addr(racers[2])), parseEther("100")); // 90 + 25%
    assert.equal(await bal(addr(racers[1])), parseEther("90")); // 3rd and 4th lose their stake
    assert.equal(await bal(addr(racers[0])), parseEther("90"));
    assert.equal(await bal(creator.account.address), parseEther("4")); // level owner 10%
    assert.equal(await forgeCoin.read.seasonPool(), parseEther("2")); // 5%
    assert.equal(await bal(forgeCoin.address), parseEther("2")); // escrow fully paid out
  });

  it("closeSeason: pays the pool to players and creators by shares, then starts season 2", async () => {
    const ctx = await deploy();
    const { forgeCoin, creator, player, buyer, deployer } = ctx;
    const id = await ctx.publishLevel("season-level", parseEther("10"));
    await forgeCoin.write.claimFaucet({ account: player.account });
    await forgeCoin.write.approve([forgeCoin.address, parseEther("100")], { account: player.account });
    const run = ctx.runResult(player.account.address, id, 1n, false); // paid run, no reward minted
    await forgeCoin.write.settleRun([run, await ctx.signRun(run)], { account: player.account });
    assert.equal(await forgeCoin.read.seasonPool(), parseEther("2"));

    await networkHelpers.time.increase(30 * 24 * 3600);

    const players = [player.account.address, buyer.account.address];
    const creators = [creator.account.address];
    const shares = [5_000n, 3_000n, 2_000n];
    const sig = await ctx.signSeason(1n, players, creators, shares);
    const before = {
      player: await forgeCoin.read.balanceOf([player.account.address]),
      creator: await forgeCoin.read.balanceOf([creator.account.address]),
    };
    await forgeCoin.write.closeSeason([players, creators, shares, sig], { account: deployer.account });

    assert.equal(await forgeCoin.read.balanceOf([player.account.address]), before.player + parseEther("1"));
    assert.equal(await forgeCoin.read.balanceOf([buyer.account.address]), parseEther("0.6"));
    assert.equal(await forgeCoin.read.balanceOf([creator.account.address]), before.creator + parseEther("0.4"));
    assert.equal(await forgeCoin.read.seasonPool(), 0n);
    assert.equal(await forgeCoin.read.season(), 2n);
  });

  it("closeSeason: reverts before the season ends, on bad shares, wrong signer and non-admin", async () => {
    const ctx = await deploy();
    const { forgeCoin, creator, player, deployer } = ctx;
    const players = [player.account.address];
    const creators = [creator.account.address];
    const shares = [6_000n, 4_000n];
    const sig = await ctx.signSeason(1n, players, creators, shares);

    await assert.rejects(
      forgeCoin.write.closeSeason([players, creators, shares, sig], { account: deployer.account }),
      /SeasonNotOver/,
    );

    await networkHelpers.time.increase(30 * 24 * 3600);

    const badShares = [6_000n, 3_000n]; // sums to 9 000
    await assert.rejects(
      forgeCoin.write.closeSeason(
        [players, creators, badShares, await ctx.signSeason(1n, players, creators, badShares)],
        { account: deployer.account },
      ),
      /InvalidSeasonInput/,
    );
    await assert.rejects(
      forgeCoin.write.closeSeason(
        [players, creators, shares, await ctx.signSeason(1n, players, creators, shares, player)], // not the server key
        { account: deployer.account },
      ),
      /InvalidSignature/,
    );
    await assert.rejects(
      forgeCoin.write.closeSeason([players, creators, shares, sig], { account: player.account }),
      /AccessControlUnauthorizedAccount/,
    );
    await forgeCoin.write.closeSeason([players, creators, shares, sig], { account: deployer.account }); // control case
    assert.equal(await forgeCoin.read.season(), 2n);
  });

  // ---------------------------------------------------------------- SPEC §11 backlog (students)
  // [B] "reward clipping at token cap" is covered at unit level (ForgeCoin.t.sol, forge-std deal()): minting
  // 100M FORGE through the public API is not realistic in an integration test.
  it.todo("[A] publish: remix of a remix → royalty split goes to the right ancestors");
  it.todo("[A] withdraw: reentrancy attack by a malicious receiver contract fails");
  it.todo("[A+B] gas report: publish, settleRun, buy, settleRace (npx hardhat test --gas-stats)");
  it.todo("[A+B] Slither static analysis report (docs/)");
});
