# Season ranking rules

`ForgeCoin.closeSeason(players, creators, shares, sig)` pays the season pool (20% of every play fee and 5% of
every race pot) to up to 10 players and up to 10 creators. The contract only checks the **signed result**; the
ranking itself is computed **off-chain** from public events. This document is the rule set the indexer must
implement and the answer to "who decides the winners, and on what criteria?".

## Who decides

| Step | Actor | Check on-chain |
|---|---|---|
| Compute scores from events | indexer (`server/`) | none |
| Sign `SeasonResult{season, players, creators, shares}` | game-server signer key | `signer` + EIP-712 domain, chain and contract |
| Submit the transaction | `DEFAULT_ADMIN` (multisig recommended) | `onlyRole`, `block.timestamp >= seasonEnd` |

Two keys are needed, so a leaked signer key alone cannot pay out. Because every input is a public event, anyone
can recompute the ranking and compare it with the signed arrays: the signer is trusted for *publishing* the
result, not for *hiding* it.

## Scoring (proposed rules)

Only runs settled by `RunSettled` events inside the season window count. **Self-plays are ignored**: runs by the
level owner or creator earn no points, matching the rule that they earn no rewards.

**Players** (score = points):
- +1 for each distinct level the player cleared (a level counts once per player, however many times replayed);
- +2 for each level where the player holds the best time at season end (`NewRecord` events).

Counting distinct levels instead of runs makes spamming one easy level worthless.

**Creators** (score = points):
- +1 for each distinct paying player on any of their levels (a distinct player counts once per creator).

Counting distinct players instead of plays stops a creator from inflating the ranking with their own wallets
playing one level; sybil wallets still count, which is why the faucet has a daily budget.

## From scores to `shares`

1. The pool is split **50% players / 50% creators**. If one category has no winner, the other gets all of it.
2. Inside a category, take the top 10 scores above zero. Ties are broken by the earlier block in which the score
   was reached, then by lower address, so the result is deterministic.
3. A winner's share is `score / sum(scores)` of their category's half, in basis points, rounded down.
4. The rounding remainder is added to the first-ranked winner so the arrays always sum to exactly 10 000
   (the contract reverts with `InvalidSeasonInput` otherwise).
5. `players` and `creators` are ordered best first; `shares` lists players first, then creators.

On-chain, each payout is `pool * share / 10 000`, rounded down. The few wei of dust stay in `seasonPool` for the
next season, so the contract never pays more than it holds.

## Known limits (to state at the oral exam)

- The signer decides what to publish: a compromised signer plus a compromised admin could pay anyone. Mitigation:
  the public events allow anyone to verify, `setSigner` rotates the key, and `pause` stops everything.
- The pool is only distributed if someone submits the transaction after `seasonEnd`; nothing is automatic.
- Sybil wallets can still earn points. Only the faucet budget and the per-day mint cap limit the damage.
- If `closeSeason` is called with empty arrays the pool simply rolls over to the next season.
