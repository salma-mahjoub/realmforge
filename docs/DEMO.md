# RealmForge — demo script (BK-01)

About 8 minutes, live in the browser on a local Hardhat chain. Every step is a real on-chain transaction signed by a wallet.
`scripts/browser-e2e/` replays the same flow automatically, which makes a good rehearsal and a fallback if the live demo breaks.

## 0. Setup (before the jury arrives, ~2 min)

```bash
npm run dev:chain        # terminal 1: Hardhat node, chain 31337
npm run deploy:local     # deploys LevelNFT + ForgeCoin, writes web/.env.local and server/.env
npm run dev:server       # terminal 2: API :8787 + Colyseus :2567 + indexer
npm run dev:web          # terminal 3: http://localhost:8080
```

You need wallets on chain 31337 (RPC `http://127.0.0.1:8545`). Import these Hardhat test accounts into MetaMask, or into separate browser profiles. They are public keys and must only be used on a local chain:

| Role | Account | Address |
|---|---|---|
| Creator | #2 | `0x3C44…93BC` |
| Player / race host | #3 | `0x90F7…b906` |
| Buyer | #4 | `0x15d3…6A65` |
| Race guest | #5 | `0x9965…A4dc` |

After `deploy:local` on a fresh chain, reset the MetaMask activity (Settings → Advanced → Clear activity tab data). Otherwise its stored nonces no longer match the new chain.

## 1. Build and publish (Creator) — "a level is an NFT"
1. **Editor**: place ground, a few coins and the goal flag. Point out that the level is plain JSON, and that its layout hash is what goes on-chain.
2. Press **T** to test-play and clear the level from the spawn point. A toast confirms "Level cleared in …".
3. **Publish**: the dialog runs 4 steps: thumbnail → IPFS pin → the **server re-simulates the clear** and signs an EIP-712 `ClearProof` → `LevelNFT.publish` from the wallet.
4. The dialog shows **"Minted level #1"**, with the id decoded from the `LevelPublished` event. Click **Open level #1**.
   - Key point: you can only mint a level you have actually beaten. Each layout hash can be minted once.

## 2. A friend plays and pays (Player) — "the token flow"
1. Switch to the player wallet and click **Get 100 FORGE** (`ForgeCoin.claimFaucet`, once per address).
2. **Play** level #1 and reach the flag. The result card shows the **reward estimate**. It uses the same formula as `ForgeCoin._computeReward`: base reward + first-clear bonus + record bonus.
3. **Settle run**: the server validates the trace and signs a `RunResult`. Then `settleRun` runs in a single transaction:
   - the play fee is split 70% owner / 20% season pool / 10% treasury (half of it burned);
   - the reward is minted to the player;
   - `LevelNFT.recordRun` updates plays, clears and the best time.
4. The header balance updates right away (100 → 130). The creator now holds 3.5 FORGE.

## 3. Sell the level (Creator → Buyer) — "ERC-721 market + royalties"
1. As the creator, on the level page: **List for sale** at 0.5 ETH.
2. As the buyer: **Market → Buy**. The NFT moves to the buyer, and the next plays pay the **new owner**.
3. As the creator: **Profile → Withdraw**. This uses the pull pattern: `pendingWithdrawals` plus a `nonReentrant` withdraw, and it is tested against a re-entrant attacker contract. The creator gets 0.475 ETH proceeds plus a 0.025 ETH royalty (5%; remixes split it 50/50 with the parent level).

## 4. 1v1 staked race (Host + Guest) — "escrow + signed results"
1. As the host: **Race → Create room**, pick the level and a 10 FORGE stake. `createRaceRoom` escrows the stake and returns a room code.
2. As the guest, in another browser window: claim the faucet, enter the code, then **Join and escrow 10 FORGE**.
3. Both players click **I'm ready**. The server counts down 3-2-1 and both players restart at spawn on **GO!**. Each sees the other Mario live; the server checks speeds and positions every tick.
4. The winner sees **YOU WIN!**. The server signs the ranking, and **anyone** can submit it with **Settle on-chain**. The 20 FORGE pot pays 60% to 1st, 25% to 2nd, 10% to the level owner and 5% to the season pool.
   - Fallback: a race that is never settled can be refunded after 1 hour.

## 5. Close (1 min)
- **How it works** (`/how-it-works`) has the architecture and trust-model diagrams.
- `docs/security/THREAT_MODEL.md` covers the server signer as a centralisation point and its mitigations (EIP-712 domains, deadlines, nonces, caps).
- Tests: `npm test` runs game-core, contracts (Solidity + TypeScript integration), the server and the web app.

## Automated rehearsal

```bash
npm i -D playwright && npx playwright install chromium   # once
VARIANT=0 node scripts/browser-e2e/run-all.mjs           # on a fresh chain
```

This drives the real UI in Chromium with an injected EIP-1193/EIP-6963 test wallet (`scripts/browser-e2e/wallet.cjs`). That wallet forwards to the Hardhat node's unlocked accounts, so `eth_sendTransaction` and `eth_signTypedData_v4` are real signatures.

`VARIANT=n` changes the goal position. Each layout can be published once, so pick a new value to publish again on the same chain. Screenshots go to `scripts/browser-e2e/shots/`.

The test wallet is not MetaMask. Do one manual rehearsal with MetaMask before the oral.
