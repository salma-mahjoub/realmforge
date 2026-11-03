# Gas report

Measured with `cd contracts && npx hardhat test nodejs --gas-stats` (Hardhat 3, solc 0.8.28, optimizer 200 runs,
EVM cancun) on the integration scenarios, which are the realistic flows. Running `npx hardhat test --gas-stats`
also works but mixes in hundreds of fuzz and invariant calls, so min/average are less meaningful there.

## Measured cost per function (gas units)

| Function | Contract | Gas (typical) | Notes |
|---|---|---|---|
| `publish` | LevelNFT | 250 k – 270 k | mint, level struct, URI, royalty, EIP-712 check, duplicate-hash and proof flags |
| `list` | LevelNFT | 48 k | one storage slot |
| `buy` | LevelNFT | 88 k | pull payments: only credits balances, no ETH sent |
| `claimFaucet` | ForgeCoin | 82 k – 116 k | first claim of the day pays extra for the daily-budget slot |
| `approve` | ForgeCoin | 46 k | needed once per player, or avoided with the permit variant |
| `settleRun` | ForgeCoin | 171 k – 259 k | fee split, reward mint, stats, `LevelNFT.recordRun`; first run on a level is the most expensive |
| `settleRunWithPermit` | ForgeCoin | 257 k | permit + run in one transaction: saves the 46 k `approve` transaction and its 21 k base cost |
| `createRaceRoom` | ForgeCoin | 184 k | stores the room and the escrow |
| `joinRace` | ForgeCoin | 75 k – 80 k | one more stake and one array push |
| `settleRace` | ForgeCoin | 145 k | three transfers + pool accounting (4 players) |
| `closeSeason` | ForgeCoin | 66 k – 99 k | grows with the number of winners (max 20) |

Deployment: `ForgeCoin` 3.82 M gas (16.6 kB bytecode), `LevelNFT` 3.08 M gas (13.3 kB). Both are under the 24 kB
contract size limit. (Slither compiles without the optimizer and warns about 27.7 kB for `ForgeCoin`; the
optimized build used for deployment is 16.6 kB.)

## Why these numbers

- Storage writes dominate (about 20 k gas for a new slot, 5 k to update one). `LevelNFT.Level` packs `playFee`,
  `plays`, `clears`, `likes` and `bestTimeMs` into one 32-byte slot.
- No `ERC721Enumerable`: it would add several slots per mint. History and leaderboards come from events and the
  off-chain indexer instead.
- `settleRun` writes a nonce, daily-mint counter, stats and balances in a single transaction. Doing the fee split
  with internal `_transfer` calls (not external ERC-20 calls) avoids extra call overhead.
- Pull payments (`pendingWithdrawals`) make `buy` cheap and safe, at the price of one extra `withdraw` (40 k).

## L1 versus L2

Gas units are the same on an Ethereum rollup because the EVM is the same. What changes is the price per unit: an
L2 charges a much lower execution price plus a data fee for publishing the transaction on L1. The table is
**illustrative**: the prices are assumptions to show the order of magnitude, not measurements.

| | Gas | L1 at 10 gwei | L2 at 0.05 gwei (+ data fee, not included) |
|---|---|---|---|
| `publish` | 270 k | 0.0027 ETH | 0.0000135 ETH |
| `settleRun` | 242 k | 0.0024 ETH | 0.0000121 ETH |
| `settleRace` | 145 k | 0.0015 ETH | 0.0000073 ETH |
| `buy` | 88 k | 0.0009 ETH | 0.0000044 ETH |

Conclusion for the project: `settleRun` is paid on every play. On L1 its cost would often exceed the reward and
the fee itself, so the design only makes sense on an L2 (Base, Optimism, Arbitrum) or a testnet. The demo runs on
Sepolia because it is free; a production deployment should target an L2. `settleRunWithPermit` is the default path
in the web app because it saves a whole transaction per player.

## Possible optimisations (not done, to mention at the oral)

- Batch several runs in one transaction (the server could sign a list of results).
- Keep `levelStats` and the NFT's stats in one place; they are mirrored in both contracts, which costs a second
  set of storage writes per run (needed today because `ILevelNFT` is frozen).
