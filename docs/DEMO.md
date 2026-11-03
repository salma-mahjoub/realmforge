# Demo scenario: from level to payout

One scripted run that exercises both contracts and the signing server end to end. It matches the final demo of
`docs/SPEC.md` §12: build a level, publish it, a friend plays and pays, the creator earns, a 1v1 race, sell the NFT.

## Setup (local chain, the fastest way to rehearse)

Three terminals at the repo root, in this order (details in `README.md`):

```bash
npm run dev:chain                          # Hardhat node :8545, chain id 31337
npm run deploy:local && npm run dev:server # deploys, writes web/.env.local + server/.env, API :8787 + rooms :2567
npm run dev:web                            # http://localhost:8080
```

After every restart of `dev:chain`, run `deploy:local` again and restart the server and the web app.

MetaMask: add the network `http://127.0.0.1:8545`, chain id `31337`, symbol ETH. Import **three** of the funded
accounts printed by `dev:chain` (public Hardhat test keys, never use them on a real network):

| Role | Hardhat account | Does |
|---|---|---|
| **Creator** | #2 | builds and publishes the level, later sells it |
| **Player** | #3 | plays, pays the fee, earns FORGE |
| **Buyer** | #4 | buys the NFT, then becomes the new owner |

(#0 deploys the contracts and is the admin; #1 is the game server's signing key: do not use it in the browser.)

## Steps and what to check

Amounts assume the level's play fee is **10 FORGE**. Check balances on the profile page, or on a block explorer
for Sepolia.

| # | Who | Action | Expected result |
|---|---|---|---|
| 1 | Creator | Connect, claim the faucet | `FaucetClaimed`; 100 FORGE |
| 2 | Creator | Editor: build a small level (a flat course with a goal a few tiles away is enough), press **Test Play** and reach the goal | the clear check passes; the publish button unlocks |
| 3 | Creator | **Publish** with a 10 FORGE play fee | `LevelPublished`; a thumbnail is generated, the level JSON is pinned, the server signs a `ClearProof`; the NFT `#1` belongs to the creator |
| 4 | Player | Switch account, claim the faucet, open the level, **play and clear it** | the server validates the run and signs a `RunResult` |
| 5 | Player | **Settle** (one permit signature, one transaction) | `RunSettled` + `FeeSplit` + `FeeBurned`. Player: 100 − 10 + 35 = **125 FORGE** (5 base + 20 first clear + 10 record, plus 0.1 per coin). Creator (owner): **+7**. Season pool **2**, treasury **0.5**, burned **0.5** |
| 6 | Player | Play and settle again, faster | no first-clear bonus: reward 5 (+10 if a new record). The creator earns another +7 |
| 7 | Creator | Play their own level and settle | the creator pays 10 and gets 7 back but **earns no reward** (self-play rule) |
| 8 | Creator | **List** the NFT for a price in ETH | `Listed` |
| 9 | Buyer | **Buy** it | `Sold`; the NFT moves to the buyer and the listing is cleared. The seller (and creator royalty) withdraw the ETH with `withdraw` |
| 10 | Player | Play again | the **new owner** (buyer) now receives the 7 FORGE, not the creator |
| 11 | Player + Buyer | **Race 1v1**: one creates a room with a 10 FORGE stake, the other joins with the code and escrows 10; both press ready; race to the goal | pot 20: **1st +12, 2nd +5**, level owner **+2**, season pool **+1**. The lobby shows the server-signed ranking and a **Settle on-chain** button. A fall does not end the race: press **R** or **Respawn** to retry from the last checkpoint; **Give up** leaves the race, which then ends once every other player finished or left. Players who did not finish are ranked by progress, so a race always settles |
| 12 | anyone | If a race is never settled, wait one hour | **Refund** returns every stake |

| 13 | admin | **Season** page: the ranking lists the player and the creator with their points and projected prize. After 30 days (on the local chain: `evm_increaseTime`), the admin presses **Close season** | `SeasonClosed`; the pool is paid 50% to the players and 50% to the creators in proportion to their points; `season` becomes 2 |

Scripted checks you can run on the local chain (no browser, no wallet) to rehearse or to prove the flow:

```bash
npm run e2e:chain    # faucet → pin → clear proof → publish → validate → settleRun and settleRunWithPermit
npm run e2e:race     # 1v1 race: escrow, signed ranking, 60/25/10/5 payout, expired result refused, refund
npm run e2e:season   # the server's ranking is signed and accepted by closeSeason (after the clock jumps 30 days)
```

Bonus checks for the oral exam:
- replay the same signed run (reload and settle again): `NonceAlreadyUsed`;
- let the signature expire (more than an hour) before settling: `SignatureExpired`;
- the admin calls `pause()`: runs and races stop, a pending race can still be refunded.

## Sepolia (public demo)

Same scenario with the Sepolia configuration. Contracts and addresses are in `docs/DEPLOYMENTS.md`.

```bash
cd server && set -a && . ./.env.sepolia && set +a && npm run dev
cd web && npm run dev -- --mode sepolia
```

You need two or three MetaMask accounts on Sepolia with a little test ETH (~0.02 each) for gas. The server key
in `server/.env.sepolia` is the one registered as signer on both contracts. Never reuse it elsewhere.

## If something breaks

| Symptom | Likely cause |
|---|---|
| Publish dialog says "The editor did not return a snapshot" | fixed: after a clear the game returns to the editor by itself, and the thumbnail falls back to the game canvas if the editor does not answer |
| Clear check says "not all checkpoints reached before goal" | the server requires every checkpoint of the level to be touched before the flag; the game now refuses the flag and shows "TOUCH THE CHECKPOINT FIRST". For a quick demo, delete the checkpoint from the level or build a short level without one |
| Clicking **Test** shows a black screen | open the browser console (F12), copy the first red error; also note the browser, its version and the screen size. This is a known open issue and could not be reproduced in the Chromium embedded in the dev tools |
| "Not found on this chain" for a new level | the indexer kept data from a previous chain: restart the server after `deploy:local` |
| Settle fails with `InvalidSignature` | the server and the web app point to different contract addresses or chains |
| "Contracts are not deployed on this network" | wrong network in MetaMask, or `web/.env.local` missing |
| `FaucetBudgetExhausted` | the faucet only mints 10,000 FORGE per UTC day, across all users |
