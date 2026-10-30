# RealmForge — contracts

Hardhat 3 (Solidity tests + TypeScript `node:test`/viem tests) · OpenZeppelin Contracts v5.6 · solc 0.8.28 (`pragma ^0.8.24`, EVM cancun).
Standalone npm package (own `package.json` / lockfile). Spec: [`../docs/SPEC.md`](../docs/SPEC.md) §4–6, §11.

## Quick start

```bash
cd contracts
npm ci
npx hardhat build                 # compile (artifacts/ + typed artifacts.d.ts)
npx hardhat test                  # all tests (Solidity + TypeScript)
npx hardhat test solidity         # unit + fuzz tests in test/*.t.sol
npx hardhat test nodejs           # integration tests in test/*.ts (Ignition deploy + viem signTypedData)
npx hardhat test --coverage       # coverage (target ≥ 90% per contract)
npx hardhat test --gas-stats      # gas report (publish, settleRun, buy, settleRace)
```

## Deploy (SPEC §6 order, Hardhat Ignition)

`ignition/modules/RealmForge.ts`: 1. `ForgeCoin(signer)` → 2. `LevelNFT(signer)` → 3. `forgeCoin.setLevelNFT(levelNFT)` → 4. `levelNFT.grantRole(GAME_ROLE, forgeCoin)`.

```bash
# in-process simulated chain (smoke test, nothing persisted)
npx hardhat ignition deploy ignition/modules/RealmForge.ts

# local node for web/server dev
npx hardhat node                                                    # terminal 1
npx hardhat ignition deploy ignition/modules/RealmForge.ts --network localhost   # terminal 2

# Sepolia — set secrets first (env vars, see .env.example, or the encrypted keystore)
npx hardhat keystore set SEPOLIA_RPC_URL
npx hardhat keystore set DEPLOYER_PRIVATE_KEY
npx hardhat keystore set ETHERSCAN_API_KEY
# put the PUBLIC address of the server signing key in ignition/parameters/sepolia.json
npm run deploy:sepolia
```

The `signer` parameter defaults to account #0 locally. Both constructors revert on `address(0)`, so the placeholder in `sepolia.json` must be replaced.

### Exporting ABIs for web/ and server/

```bash
npm run export-abi                                    # → ../web/src/contracts/generated/ (default in EXPORT_CONFIG)
npm run export-abi -- --out ../server/src/generated   # or EXPORT_ABI_OUT=<dir>
```
Writes `LevelNFT.abi.ts` / `ForgeCoin.abi.ts` (`as const`, typed for viem/wagmi), `*.json`, and `addresses.json` (`{ chainId: { LevelNFT, ForgeCoin } }` read from `ignition/deployments/`). Only run it when the owner of the target dir asks for it.

## Layout

```
contracts/
├─ src/
│  ├─ LevelNFT.sol              Student A — ERC-721 levels, market, royalties, ClearProof
│  ├─ ForgeCoin.sol             Student B — ERC-20 FORGE, runs, races, seasons
│  ├─ interfaces/ILevelNFT.sol  frozen A↔B interface (SPEC §6)
│  ├─ interfaces/IForgeCoin.sol RunResult struct, events, game functions
│  └─ mocks/MockLevelNFT.sol    lets Student B test without LevelNFT
├─ test/
│  ├─ LevelNFT.t.sol            Solidity unit + fuzz (A)
│  ├─ ForgeCoin.t.sol           Solidity unit + fuzz, uses MockLevelNFT (B)
│  └─ Integration.ts            Ignition deploy, publish → settleRun → recordRun → buy, permit, it.todo backlog
├─ ignition/modules/RealmForge.ts   deploy module · ignition/parameters/sepolia.json
├─ scripts/export-abi.ts
└─ hardhat.config.ts            networks: hardhat (default), hardhatMainnet, localhost, sepolia
```

## Ownership

| | Student A | Student B |
|---|---|---|
| Contract | `src/LevelNFT.sol` | `src/ForgeCoin.sol` |
| Tests | `test/LevelNFT.t.sol` | `test/ForgeCoin.t.sol` |
| EIP-712 | `ClearProof` | `RunResult`, `RaceResult`, `SeasonResult` (+ ERC-2612 `Permit`) |
| Shared | `src/interfaces/ILevelNFT.sol` (A owns, B consumes — change only together), `test/Integration.ts`, Ignition module | |

`// TODO(studentA)` / `// TODO(studentB)` comments mark the design decisions left to each student (remix royalty split, `_safeMint`, burn share of the fee, `coins` bonus, self-play farming, race deadline, season ranking criteria). The `it.todo` entries in `test/Integration.ts` list the remaining SPEC §11 tests.

## EIP-712 — server and web MUST match exactly

Both domains: `{ name, version: "1", chainId, verifyingContract }` (no salt). Read them on-chain with `eip712Domain()` (ERC-5267) if in doubt.

| Contract | Domain name | Version | verifyingContract |
|---|---|---|---|
| LevelNFT | `RealmForge LevelNFT` | `1` | LevelNFT address |
| ForgeCoin | `RealmForge ForgeCoin` | `1` | ForgeCoin address (same domain for ERC-2612 `Permit`) |

Type strings (hashed on-chain as `*_TYPEHASH` constants):

```
ClearProof(address creator,bytes32 layoutHash,uint256 deadline)
RunResult(address player,uint256 levelId,uint32 timeMs,bool cleared,uint16 coins,uint256 nonce,uint256 deadline)
RaceResult(bytes32 roomId,address[] ranking)
SeasonResult(uint256 season,address[] players,address[] creators,uint256[] shares)
Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)   // OpenZeppelin ERC20Permit
```

viem `types` objects (copy-paste for `signTypedData`):

```ts
export const CLEAR_PROOF_TYPES = { ClearProof: [
  { name: "creator", type: "address" }, { name: "layoutHash", type: "bytes32" }, { name: "deadline", type: "uint256" },
]} as const; // domain: { name: "RealmForge LevelNFT", version: "1", chainId, verifyingContract: levelNFT }

export const RUN_RESULT_TYPES = { RunResult: [
  { name: "player", type: "address" }, { name: "levelId", type: "uint256" }, { name: "timeMs", type: "uint32" },
  { name: "cleared", type: "bool" }, { name: "coins", type: "uint16" }, { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
]} as const; // domain: { name: "RealmForge ForgeCoin", version: "1", chainId, verifyingContract: forgeCoin }

export const RACE_RESULT_TYPES = { RaceResult: [
  { name: "roomId", type: "bytes32" }, { name: "ranking", type: "address[]" },
]} as const;

export const SEASON_RESULT_TYPES = { SeasonResult: [
  { name: "season", type: "uint256" }, { name: "players", type: "address[]" },
  { name: "creators", type: "address[]" }, { name: "shares", type: "uint256[]" },
]} as const;
```

Semantics the server must respect:
- **ClearProof**: `creator` = the wallet that will call `publish` (msg.sender). One proof = one publish (`usedProof[digest]`), and `layoutHash` can be published once (`hashUsed`).
- **RunResult**: `nonce` is an **unordered per-player nonce** (`runNonceUsed[player][nonce]`): the server picks any unused value (e.g. a DB id). `msg.sender` must equal `player`. `deadline` is a unix timestamp in seconds.
- **RaceResult**: `ranking[0]` = 1st and `ranking[1]` = 2nd; both must have joined the room. A room settles once (no nonce needed).
- **SeasonResult**: `season` = current `season()`; `shares` are basis points, one per winner (`players` then `creators`), summing to 10 000; ≤ 10 per category. The tx is sent by DEFAULT_ADMIN.
- `settleRunWithPermit` takes `uint8 v` (ERC-2612 / viem `parseSignature`), not `uint256 v` as written in SPEC §5.3; the permit `value` must be the level's current `playFee`.

## Tokenomics constants (ForgeCoin)

Cap 100 M · faucet 100 once · fee split 70 % owner / 20 % season pool / 10 % treasury (held in-contract, `withdrawTreasury`) · clear reward `min(5 + 45·(1 − clears/plays), 50)` + 20 first clear + 10 record · daily mint cap 200 per player (UTC day) · race 60/25/10 owner/5 pool, refund after 1 h · season 30 days.
All amounts in FORGE wei (18 decimals). Pause blocks faucet/runs/races, never refunds or ERC-20 transfers.
