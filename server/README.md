# @realmforge/server

Off-chain services for RealmForge (SPEC §2, §7): a **Colyseus** game server (race / co-op rooms) and a **Fastify** API (IPFS pinning, run validation, EIP-712 signing, event indexer).

Standalone npm package (own lockfile), Node ≥ 22.13, TypeScript, ESM.

```bash
cp .env.example .env      # dev defaults: local hardhat chain, PUBLIC test signer key
npm install
npm run dev               # tsx watch: API on :8787, Colyseus on :2567
npm test                  # vitest
npm run build && npm start
```

## Layout

```
server/
├─ abi/                     LevelNFT.json, ForgeCoin.json — minimal event ABIs (indexer)
├─ src/
│  ├─ index.ts              boots API + game server + indexer
│  ├─ config.ts             zod-validated env (see .env.example)
│  ├─ eip712.ts             domains + typed-data (ClearProof, RunResult, RaceResult, SeasonResult)
│  ├─ signer.ts             GameSigner: viem privateKeyToAccount + signTypedData, nonces, deadlines
│  ├─ ipfs.ts               Pinata pinner / local pinner (data/ipfs, CIDv1 raw computed locally)
│  ├─ db.ts                 SQLite (node:sqlite) schema
│  ├─ levels.ts             pinned levels + levelId -> layoutHash (from indexer)
│  ├─ services.ts           dependency wiring
│  ├─ level/                level.v1 zod schema, canonical JSON + layoutHash, static analysis (min time, checkpoints)
│  ├─ validation/           plausibility checks (SPEC §3.6) + replay re-simulation hook (TODO)
│  ├─ api/                  Fastify app + routes
│  ├─ indexer/              viem getContractEvents backfill + watchContractEvent -> SQLite
│  ├─ rooms/                RaceRoom, CoopRoom (@colyseus/schema state, 20 Hz patches)
│  └─ game.ts               Colyseus Server (ws transport)
└─ test/                    vitest
```

## HTTP API (default `:8787`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | status, chain id, signer address, contract addresses, IPFS provider, indexer progress |
| POST | `/levels/pin` | `{ level, thumbnail?, description? }` → validates level.v1 (SPEC §3.4), `layoutHash = keccak256(canonicalJSON)`, pins level JSON + thumbnail + ERC-721 metadata. Returns `{ layoutHash, levelCid, thumbnailCid, metadataCid, tokenURI, minTimeMs, provider }` |
| GET | `/ipfs/:cid` | dev gateway for locally stored files |
| POST | `/levels/clear-proof` | `{ creator, layoutHash, run }` → validates the creator's clear, returns signed EIP-712 `ClearProof` for `LevelNFT.publish` |
| POST | `/runs/validate` | `{ player, levelId, run }` → validates, returns signed `RunResult` for `ForgeCoin.settleRun` (and stores the input log as a ghost replay) |
| GET | `/levels?sort=new\|popular\|hardest\|liked&creator=&owner=&limit=&offset=` | level browser (indexer data) |
| GET | `/levels/:id` | one level |
| GET | `/levels/:id/leaderboard` | best settled time per player |
| GET | `/levels/:id/replays` | top-3 validated replays (ghost race) |

Signed responses carry bigints as decimal strings: `{ result|proof, signature, signer }`.

### Run submission (`run`)

```jsonc
{
  "timeMs": 5283, "cleared": true, "coins": 3,
  "trace": [{ "f": 0, "x": 2, "y": 25 }, { "f": 2, "x": 2.24, "y": 24.99 }],  // frame (60 Hz) + position in TILES
  "checkpoints": [{ "id": 10, "f": 150 }],                                     // checkpoint entity id + frame
  "inputLog": "<base64 compressed frame,buttons log>"                          // optional, for replay re-sim / ghosts
}
```

Plausibility (src/validation): max speed per tick (from game-core MOVEMENT constants, ×1.75 tolerance; door/pipe teleports and respawns allowed), checkpoint order (by `props.order`, else x), all checkpoints before goal, trace starts at spawn / ends at goal, `timeMs` consistent with trace frames, `timeMs ≥ minTimeMs` (computed at pin/publish time), `timeMs ≤ timeLimit`, `coins ≤` coins in level.

### Canonical JSON (layoutHash)

The web client MUST hash exactly the same bytes: object keys sorted recursively (JS default `sort()`), no whitespace, values as `JSON.stringify`, `undefined` members dropped, UTF-8. See `src/level/canonical.ts`. The server pins the canonical bytes themselves, so `keccak256(file) == layoutHash`.

## EIP-712

Reconciled with `contracts/src` (a test checks the Solidity sources verbatim when `../contracts` exists):

| Struct | Domain | Type string |
|---|---|---|
| ClearProof | `RealmForge LevelNFT` v1, LevelNFT address | `ClearProof(address creator,bytes32 layoutHash,uint256 deadline)` |
| RunResult | `RealmForge ForgeCoin` v1, ForgeCoin address | `RunResult(address player,uint256 levelId,uint32 timeMs,bool cleared,uint16 coins,uint256 nonce,uint256 deadline)` |
| RaceResult | ForgeCoin | `RaceResult(bytes32 roomId,address[] ranking)` |
| SeasonResult | ForgeCoin | `SeasonResult(uint256 season,address[] players,address[] creators,uint256[] shares)` |

Nonces are random 256-bit values (contracts keep a used-nonce mapping). Deadlines = now + `SIGNATURE_TTL_SEC`. RaceResult/SeasonResult have no nonce/deadline: on-chain they are single-use per room / season.

**Trust boundary:** `SIGNER_PRIVATE_KEY` is the centralization point (SPEC §5.5). The `.env.example` value is Hardhat account #1 — a **public** key, for local chains only.

## Game server (Colyseus, default `:2567`)

Rooms `race` and `coop`, 2–4 players, state patches at 20 Hz.

- Create/join options: `{ address, name?, signature?, levelId?, raceId?, minPlayers?, maxPlayers?, timeLimitSec? }`. `address` is required; `signature` (optional for now) is a `personal_sign` of `joinMessage(roomId, address)`.
- `raceId` = the bytes32 used in `ForgeCoin.createRaceRoom`; defaults to `keccak256(colyseusRoomId)`.
- Client → server messages: `ready`, `pos {f,x,y,vx,vy}` (tiles), `checkpoint {id}`, `coin {count}`, `finish`.
- Server → client: `countdown`, `start`, `violation`, `disqualified`, `finished`, `checkpoint` (co-op shared respawn), `result`.
- State: `phase`, `startAt`, `elapsedMs`, `timeLimitMs`, `players` (address, position, checkpoint, finished, finishTimeMs, strikes…), `finishOrder`; co-op adds `sharedCheckpoint`.
- Server checks per `pos`: speed per tick, client clock not ahead of server; `checkpoint` order; `finish` near goal, all checkpoints, ≥ level min time. 5 strikes → disqualified.
- **Race end** → `result: { result: RaceResult, signature, signer, times }` for `settleRace`. **Co-op end** → each player gets a signed `RunResult`.

Note: server uses Colyseus **0.16** to match the web client's `colyseus.js@0.16`.

## Indexer

When `LEVEL_NFT_ADDRESS` / `FORGE_COIN_ADDRESS` are set, the indexer backfills with `getContractEvents` (2 000-block chunks from `INDEXER_START_BLOCK` or the last saved block), then follows with `watchContractEvent`. Every log is applied once (`processed_logs`). Tables: `levels`, `runs`, `sales`, `races`, plus `pinned_levels`, `signed_runs`.

ABIs come from `abi/*.json` (human-readable event signatures; a full JSON ABI or a Hardhat artifact `{ abi: [...] }` also works). Event params are read **by name**.

## TODO

- Replay re-simulation with `@realmforge/game-core` (`src/validation/replay.ts` — `ReplayVerifier` interface, Noop default).
- Import physics constants from game-core instead of copying them (`src/validation/constants.ts`).
- Require join signatures (or SIWE) in rooms; rate-limit `/runs/validate` per address.
- `/runs/validate` only knows levels pinned through this server; fetch unknown level JSON from IPFS via `tokenURI`.
- Replace placeholder ABIs with exported contract artifacts (`contracts: npm run export-abi`).
- Season signing endpoint (admin-only) using `GameSigner.signSeasonResult`.
- Persist race results / coop results; reconnect flow test for rooms.
