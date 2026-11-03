# Slither static analysis

- Tool: Slither 0.11.6, solc 0.8.28 (the compiler Hardhat downloads), OpenZeppelin 5.6.1.
- Scope: `src/ForgeCoin.sol` and `src/LevelNFT.sol`. OpenZeppelin and mocks are excluded.
- Date: 2 November 2026, branch `feature/forgecoin-hardening`.

## How to reproduce

```bash
python3 -m venv .venv && .venv/bin/pip install slither-analyzer
cd contracts && npx hardhat build            # downloads solc 0.8.28 into the Hardhat cache
SOLC=$(ls ~/Library/Caches/hardhat-nodejs/compilers-v3/macosx-amd64/solc-macosx-amd64-v0.8.28*)
for c in ForgeCoin LevelNFT; do
  ../.venv/bin/slither src/$c.sol --solc "$SOLC" \
    --solc-remaps "@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/" \
    --filter-paths "node_modules|mocks" --exclude-dependencies
done
```

Any `solc 0.8.28` binary works; on Linux use `solc-select install 0.8.28` instead of the Hardhat cache path.

## Result

**No high or medium severity finding.** 12 informational/low results on `ForgeCoin`, 3 on `LevelNFT`. None required
a code change. Each one is justified below.

### ForgeCoin

| Detector | Where | Verdict | Justification |
|---|---|---|---|
| `uninitialized-local` | `closeSeason`: `paid`, `total`; `_settleRun`: `reward` | False positive | Solidity zero-initialises locals. Each one is an accumulator that starts at 0 on purpose. |
| `unused-return` | `levelInfo(...)` in `settleRunWithPermit`, `createRaceRoom`, `settleRace` | False positive | Tuple destructuring keeps only the fields needed (`(,, playFee,)`); the other values are irrelevant to that function. |
| `unused-return` | `_checkSignature`: `ECDSA.tryRecover` | False positive | The third return value (a `bytes32` detail) is not needed. The error code `err` and the recovered address are both checked on the next line. |
| `timestamp` | `_settleRun`, `joinRace`, `settleRace`, `refundRace`, `closeSeason` | Accepted | Deadlines, the 1 h race timeout and the 30-day season are expressed in time. A validator can move `block.timestamp` by seconds, which cannot change the outcome of windows measured in minutes to days. |

### LevelNFT

| Detector | Where | Verdict | Justification |
|---|---|---|---|
| `unused-return` | `_checkSigner`: `ECDSA.tryRecover` | False positive | Same as above: `err` and `recovered` are used. |
| `timestamp` | `publish`: `block.timestamp > deadline` | Accepted | Proof deadline of the EIP-712 `ClearProof`. |
| `low-level-calls` | `withdraw`: `call{value: amount}` | Accepted | Recommended way to send ETH (no 2300 gas limit). Protected by `nonReentrant`, the balance is zeroed before the call (checks-effects-interactions), and the pull pattern means the failure of one recipient blocks nobody else. |

## What Slither cannot tell us

Slither is pattern based. It does not check business logic (who may earn rewards, how money is split) nor the trust
model. Those are covered by the unit, fuzz, invariant and integration tests, and by the threat model: the server
signer is a centralisation point (see `docs/SPEC.md` §5.5 and `docs/SEASONS.md`).
