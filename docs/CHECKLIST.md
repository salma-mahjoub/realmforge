# RealmForge — Implementation Checklist

Status snapshot: **30/10/2026**, after the integration pass. Tests: game-core 33 · contracts 42 (+9 todo) · server 31 · web 10, all passing. The local end-to-end chain flow passes.
Reference: [SPEC.md](SPEC.md) (section numbers below refer to it) · Agent rules: [../AGENTS.md](../AGENTS.md)

Legend: `[x]` done and verified by tests or a build · `[~]` partly done or in progress · `[ ]` not started

| Area | Progress |
|---|---|
| Contracts (§4–6) | ~90% |
| Mario-like controller (§3.1) | ~90% |
| Level elements (§3.2) | ~80% |
| Assets | ~95% |
| Editor (§3.3) | ~65% |
| Publish flow | ~70% (scripted end to end OK, UI path not clicked with a wallet) |
| Solo play + settlement | ~75% |
| Multiplayer (§3.5–3.6) | ~40% |
| Web pages + wallet (§3.7) | ~65% |
| Server (§7) | ~75% |
| CI | written, never run |

---

## 1. Smart contracts — `contracts/` (Hardhat 3, OpenZeppelin 5.6.1, solc 0.8.28)

### Shared
- [x] `ILevelNFT` interface frozen per §6
- [x] `IForgeCoin` interface (RunResult struct, events, game functions)
- [x] `MockLevelNFT` so Student B can test without Student A's contract
- [x] Ignition deploy module (§6 order: ForgeCoin → LevelNFT → link → grant GAME_ROLE), local deploy verified
- [x] `scripts/export-abi.ts`
- [x] ABIs exported to web + server; `ignition/parameters/localhost.json` (account #1 signer)
- [x] 42 tests passing (38 Solidity, 4 Node), 0 compiler warnings
- [ ] 9 `it.todo` integration tests from §11
- [ ] Slither static analysis report and discussion (`docs/security/`)
- [ ] Gas report for `publish`, `settleRun`, `buy` and `settleRace`, comparing L1 and L2
- [ ] Coverage ≥ 90% per contract
- [ ] Sepolia deployment + Etherscan verification; addresses stored in `docs/DEPLOYMENTS.md`

### Student A — `LevelNFT.sol` (ERC-721 + ERC-2981)
- [x] `publish` with EIP-712 `ClearProof`, unique `layoutHash`, fee cap, parent check
- [x] `setPlayFee`, `setActive`, `like`
- [x] `list` / `unlist` / `buy` with pull payments and `withdraw` (nonReentrant)
- [x] `recordRun` (GAME_ROLE only), `levelInfo`, `_update` clears listing on transfer
- [x] Remix royalty split (currently 50/50 between the remix and the original creator)
- [ ] Resolve 3× `TODO(studentA)` design decisions
- [ ] Owner-side defence for the oral: NFT standard, royalties, market security

### Student B — `ForgeCoin.sol` (ERC-20 + Permit + Capped + Pausable)
- [x] `claimFaucet` (once per address)
- [x] `settleRun` / `settleRunWithPermit` (`uint8 v`), 70/20/10 split, daily mint cap, supply cap
- [x] Race escrow: `createRaceRoom`, `joinRace`, `settleRace`, `refundRace` (1 h timeout)
- [x] `closeSeason`, `setSigner`, `pause`/`unpause`, `withdrawTreasury`
- [x] Fuzz: fee split sums correctly, supply never exceeds the cap
- [ ] Resolve 6× `TODO(studentB)` design decisions
- [ ] Owner-side defence for the oral: tokenomics, signatures, escrow, reentrancy

---

## 2. Game core — `game-core/` (pure TypeScript, deterministic)
- [x] Mario-like controller: walk/run, skid, speed-dependent jump, variable jump, coyote time and jump buffer, crouch, wall slide and wall jump, corner correction, ice/slime/conveyor, platform carry, stomp bounce, spring (21 tests)
- [x] Fixed-point maths, 60 Hz, replay bitmask encoder with a determinism test
- [x] `createMatterPlayer` Phaser/Matter adapter + `npm run lab`
- [x] Movement research with cited sources: `game-core/docs/MOVEMENT_RESEARCH.md`
- [x] 33 tests; optional atlas `frame` on element textures
- [x] `ELEMENTS` registry: all §3.2 elements, with prop descriptors for the editor, `npm run lab:elements`
- [ ] **Multi-player support** in the elements runtime (one physics player per Matter world; remote players are interpolated sprites only)
- [ ] Dash power-up (6 px/frame) exceeds the server speed bound (2.5 × 1.75), so dash runs get rejected. Align the bound with game-core.
- [ ] Headless re-simulation on the server, so a replay can be checked against trusted collisions

## 3. Assets — `assets/`, `web/public/assets/`
- [x] Kenney packs + OpenGameArt music, all CC0, recorded in `assets/CREDITS.md`
- [x] SVG originals + PNG rasters, atlases, 64 px tilesets for 4 themes, `manifest.json`
- [x] 37/37 element IDs covered, reproducible `npm run build:assets` (4 MB)
- [ ] Extra character skins (optional, stretch goal)

## 4. Web app — `web/` (Vite, React 19, Phaser 3.90 + Matter, wagmi 2 / viem / RainbowKit)
- [x] 8 routes styled after the mockups, 404 page, no console errors
- [x] React ⇄ Phaser EventBus, scenes Boot / Preloader / Editor / Play / Race
- [x] Manifest-driven preloader with placeholder fallback
- [x] Level types, RLE, canonical JSON + `layoutHash`, sample level
- [x] Real ABIs from export-abi (interim ABI deleted)
- [x] Hooks for `claimFaucet`, `publish`, `settleRun` + `settleRunWithPermit` (approve fallback), `useMarket` list/unlist/buy; Buy buttons wired
- [x] PlayScene uses the game-core player + element runtime + fixed 60 Hz clock; replay bitmask + trace + checkpoints recorded (verified in browser)
- [x] API and Colyseus client aligned with the server's real routes and rooms
- [x] vitest added (10 tests)
- [ ] Pages read real indexer/contract data instead of `data/mock.ts` (profile, market listings, activity and earnings still mock: these need server endpoints)
- [ ] Free Reown/WalletConnect project ID in `web/.env.local` (currently a 403 warning)
- [ ] RaceScene waits for the server countdown/start; ghost replays rendered
- [ ] Wallet connect + transactions tested in a browser with MetaMask
- [ ] Read the minted token ID from the publish receipt

### Editor (§3.3)
- [x] Grid, palette (7 categories, 36 elements), place/erase, 100-step undo/redo, T toggles test-play, autosave, JSON import/export
- [x] Palette + property panel driven by the game-core `ELEMENTS` prop descriptors (verified in browser)
- [x] Test Play uses the game-core PlayScene
- [ ] Copy/paste, rotate, link mode (door↔door, switch→blocks)
- [ ] Theme and music picker
- [~] Publish flow (pin → clear-proof → mint) wired; scripted end to end OK, UI path with a wallet not yet clicked

## 5. Server — `server/` (Fastify, Colyseus 0.16, viem, node:sqlite)
- [x] Zod config, `.env.example`
- [x] EIP-712 signer; the test confirms the type strings match `contracts/src` exactly
- [x] Routes: `/levels/pin`, `/levels/clear-proof`, `/runs/validate`, `/levels`, `/levels/:id`, leaderboard, replays, `/ipfs/:cid`, `/health`
- [x] Plausibility checks: speed per tick, checkpoint order, minimum time
- [x] Event indexer (catch-up, then watch, idempotent writes)
- [x] RaceRoom + CoopRoom at 20 Hz, signed RaceResult/RunResult; test with two clients
- [x] 29 tests passing
- [x] Movement constants imported from game-core (`file:../game-core`)
- [x] `GET /levels/:id/file`; schema accepts the web level format; 31 tests
- [ ] Join signatures / SIWE mandatory
- [ ] Rate limiting on `/runs/validate`
- [ ] Fetch level JSON from IPFS for levels not pinned through this server
- [ ] Profile / market / activity / earnings endpoints
- [ ] Season-signing admin endpoint, persisting race results, reconnect handling

## 6. Integration and operations
- [x] Private GitHub repo: https://github.com/MedSlimane/realmforge
- [x] CI workflow written (`.github/workflows/ci.yml`)
- [ ] CI green on GitHub
- [x] Shared `layoutHash` test vector `test-vectors/layout-hash.json` (web == server)
- [x] Root `README.md` + root scripts: `dev:chain`, `deploy:local`, `dev:server`, `dev:web`, `test`, `build`, `e2e:chain`
- [x] Scripted local end-to-end run (`npm run e2e:chain`): faucet → pin → clear-proof → publish → validate → settleRun + settleRunWithPermit → plays=2, creator +7, player +30, pool 2, treasury 1
- [ ] Browser end-to-end run: build a level → publish → second wallet plays and pays → creator earns → sell the NFT
- [ ] Race 1v1 end to end with stake escrow

## 7. Module deliverables (BK-01)
- [ ] **S6 intermediate version:** publish end to end + solo play + `settleRun` + browse page
- [ ] Architecture diagram (`docs/architecture.*`)
- [ ] Threat model, including the server-signer centralisation point and its mitigations
- [ ] Slither + gas report (see §1)
- [ ] **S7 final demo script**: editor → publish → friend plays → creator earns → race → sell NFT
- [ ] Slides + each student's oral notes (AA4/AA5/AA6)

### Cut order if behind schedule
Season distribution → co-op → remix royalties → race escrow. **Never cut:** both contracts, the token flow between them, signature checks, tests.
