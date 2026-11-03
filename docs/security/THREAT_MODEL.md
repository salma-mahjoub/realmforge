# Threat model: ForgeCoin and the signing trust boundary

Scope: `ForgeCoin.sol` (FORGE token, run settlement, races, seasons, faucet) and the server key that feeds it.
`LevelNFT` is covered only where it touches ForgeCoin. Deployed on Sepolia (`docs/GUIDE.md` §6). FORGE has no
market value on a testnet, so the "impact" column describes what would matter on a real network.

## 1. What we protect

| Asset | Where | Why it matters |
|---|---|---|
| FORGE supply and its cap (100 M) | `totalSupply`, `ERC20Capped` | inflation destroys the value of every holder's balance |
| Player balances | ERC-20 balances | funds cannot be taken by anyone else |
| Race escrow | contract balance | stakes must come back to the players or be paid out exactly |
| Season pool and treasury | `seasonPool`, `treasuryBalance` | only released by the documented paths |
| Fairness of rewards | `settleRun` | rewards must follow real, validated runs |

## 2. Actors and what we trust

| Actor | Trusted for | Not trusted for |
|---|---|---|
| **Game-server signer key** | stating that a run, a race ranking or a season ranking really happened | nothing else: it cannot move balances directly |
| **Admin (`DEFAULT_ADMIN_ROLE`, the deployer)** | pause/unpause, `setSigner`, `withdrawTreasury`, submitting `closeSeason`, one-time `setLevelNFT` | minting, taking player funds or race escrow |
| **LevelNFT contract** | `levelInfo` answers and `recordRun`; linked once by the admin and never changed | arbitrary behaviour: it is called after state is updated, under `nonReentrant` |
| **Players** | nothing | submitting results that were not signed, replaying, farming |
| **Anyone** | submitting `settleRace` / `refundRace` | they can only submit what is signed or what has timed out |

The contracts are **not upgradeable**: nobody can change the rules after deployment (a strength for users, a
limit if a bug is found, which is why `pause` and `setSigner` exist).

## 3. The central risk: the server signer

Everything the server signs is accepted. The contract checks that the signature comes from `signer`, that it is
bound to the chain and the contract (EIP-712 domain), that the deadline has not passed, and that a nonce or a
single-use room/season has not been consumed. It **cannot** check that the run really happened.

| If the signer key leaks or the server is compromised, an attacker can... | Bound by the contract | Residual impact |
|---|---|---|
| sign `RunResult`s with `cleared = true` and any `coins` | per run: reward capped (max 50 + 20 + 10 + 5); per address: 200 FORGE/day; global: 100 M cap | each fresh wallet can mint 200/day, so the daily cap limits *each address*, not the total. Only the supply cap bounds an attack with many wallets. **Highest residual risk.** |
| sign a `RaceResult` for a room where the attacker is a player | ranking must contain room players; pays 60 % + 25 % of that room's pot at most | steals up to 85 % of the stakes of honest players who joined that room |
| sign a `SeasonResult` | also needs the admin key to submit | pays the pool to chosen addresses, only with a second compromised key |
| sign `ClearProof`s (LevelNFT) | `hashUsed` and `usedProof` | spam of published levels |

**Mitigations in place**
- `setSigner` lets the admin rotate the key at once; the old signatures stop working (`SignerRotation` test).
- `pause` stops faucet, runs, race creation, join and settlement, while `refundRace` keeps working so nobody's
  stake is trapped (`Race_RefundAfterTimeout` test).
- Every signed message has a `deadline` (default 1 hour) so leaked signatures expire.
- Per-run reward caps, daily mint cap per player and the global supply cap (fuzz and invariant tests).
- The key lives in `server/.env` only; the admin is a different key, so a server breach alone cannot call
  `setSigner`, `pause` or `withdrawTreasury`.

**What we would add with more time**: sign with a hardware or cloud KMS; a global daily mint budget (like the
faucet's) as a circuit breaker; on-chain monitoring that pauses automatically on abnormal minting; headless
re-simulation of the input log on the server (`docs/SPEC.md` §3.6, stretch goal).

## 4. Threat table

| # | Threat | Mitigation | Evidence | Residual |
|---|---|---|---|---|
| T1 | Replay of a signed run | per-player `runNonceUsed`, `deadline`, domain with `chainId` + contract | `SettleRun_RevertsReplay`, `RevertsExpired`; integration: a ClearProof for another chain is rejected | low |
| T2 | Result tampered after signing | the signature covers every field (`RunResult`, `RaceResult` with deadline, `SeasonResult`) | `RevertsTamperedResult`, `Race_Settle_RevertsWhenDeadlineIsTampered` | low |
| T3 | Another player submits my signed run | `msg.sender == r.player` | `RevertsWrongSender` | low |
| T4 | Reentrancy | `nonReentrant` on every state-changing external function, checks-effects-interactions (nonce, balances and stats are written before `recordRun`); ERC-20 has no hooks | code review, Slither (no reentrancy finding) | low |
| T5 | Permit griefing: a front-runner burns my permit nonce | `permit` is wrapped in `try/catch`; the run still settles if the allowance exists | `SettleRunWithPermit_SurvivesFrontRunPermit` | low |
| T6 | Owner/creator farms rewards on their own level | self-plays pay the fee but earn nothing and do not touch reward stats | `SettleRun_OwnerEarnsNoReward`, `SettleRun_CreatorWhoSoldTheLevelEarnsNoReward`, `SettleRun_SelfPlayDoesNotConsumeFirstClearBonus` | **medium**: a second wallet gets around it, and a free level (`playFee = 0`) costs nothing. Bounded by 200 FORGE/day per wallet and by the server's run validation. The server signs a given recording only once per level (`run_fingerprints`, HTTP 409 on a repeat), so replaying one winning run in a loop no longer works; a bot that perturbs its trace still does |
| T7 | Faucet Sybil | one claim per address plus a global 10,000 FORGE/day budget | `Faucet_DailyBudgetStopsSybilWallets` | medium: cannot tell who is who, and an attacker can exhaust the day's budget (denial of service for newcomers) |
| T8 | Race escrow lost or stuck | stakes held by the contract; refund after 1 h by anyone, even while paused; a settled race can never be refunded | invariant `ContractBalanceIsFullyAccounted` (mutation-tested), race tests | low |
| T9 | Race ranking abuse (outsider, duplicate) | ranking checked against room members before the signature | `Race_Settle_RevertsWithOutsider/DuplicateRank` | low |
| T10 | Race room id squatting: someone creates the room id the server expects | none yet | none | low (DoS of one room). Fix: derive the id from the creator address and a counter |
| T11 | Inflation beyond the cap or daily limit | `ERC20Capped`, `DAILY_MINT_CAP`, clipped mints | `ClipsRewardAtSupplyCap`, `DailyCap_ClipsPartialReward`, invariants | low |
| T12 | Rounding loses or creates tokens | remainder goes to the last share (fee split, race pot); season dust stays in the pool | `testFuzz_SplitFee_SumsToFee`, `FeeIsFullyAccountedFor` | low |
| T13 | Unbounded loops (gas DoS) | max 4 players per race, max 10 winners per season category | `Race_Join_RevertsWhenFull`, `CloseSeason_RevertsOnBadInput` | low |
| T14 | Admin abuse | cannot mint or take escrow; `withdrawTreasury` only moves `treasuryBalance`; but `setSigner` makes the admin as powerful as the signer | role tests | **medium** by design: use a multisig in production |
| T15 | Bad ranking in `closeSeason` | needs signature **and** admin tx; shares must total 10 000; anyone can recompute the ranking from public events (`docs/SEASONS.md`) | `CloseSeason_*` tests | medium |
| T16 | Signature malleability | OpenZeppelin `ECDSA.tryRecover` rejects malleable signatures; replay is blocked by nonces anyway | library | low |
| T17 | Server unavailable | funds stay safe; plays cannot settle until it is back; races time out into refunds | refund path | availability only |

## 5. Off-chain gaps (from `docs/CHECKLIST.md`, not solved yet)

- No rate limiting on `/runs/validate`, and wallet sign-in (SIWE) is not mandatory: anyone can request signatures.
- The server checks plausibility (speed per tick, checkpoint order, minimum time, coins ≤ level maximum) but does not
  yet re-simulate the replay; a bot that stays within the physical limits would pass.
- Level files fetched from IPFS for levels not pinned by this server are not yet verified.

These are the real source of T6 and of the highest-risk row in section 3, so they are the next priority for the
server owner.

## 6. Supply chain and tooling

- Contracts depend on OpenZeppelin 5.6.1 only (no hand-written ERC code). Versions are locked in `package-lock.json`.
- `npm audit` reports advisories in development tooling (Hardhat toolchain, bundlers). They do not ship in the
  deployed bytecode. Review them before any production release.
- The deployment key is a throw-away wallet stored in the encrypted Hardhat keystore; the signer key is generated
  separately and never committed.

## 7. Checks run

Unit, fuzz, invariant and integration tests (`docs/CHECKLIST.md`), Solidity coverage of ForgeCoin 99.5 %, Slither
without high or medium findings (`docs/security/SLITHER.md`), gas report (`docs/GAS.md`).
