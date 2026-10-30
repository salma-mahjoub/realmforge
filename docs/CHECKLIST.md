# RealmForge — Implementation Checklist

Status snapshot: **30/10/2026**. Bootstrap commit `1e57ca7`; the integration pass is still in progress (uncommitted).
Reference: [SPEC.md](SPEC.md) (section numbers below refer to it) · Agent rules: [../AGENTS.md](../AGENTS.md)

Legend: `[x]` done and verified by tests or a build · `[~]` partly done or in progress · `[ ]` not started

| Area | Progress |
|---|---|
| Contracts (§4–6) | ~90% |
| Mario-like controller (§3.1) | ~90% |
| Level elements (§3.2) | ~80% |
| Assets | ~95% |
| Editor (§3.3) | ~60% |
| Publish flow | ~40% |
| Solo play + settlement | ~50% |
| Multiplayer (§3.5–3.6) | ~35% |
| Web pages + wallet (§3.7) | ~60% |
| Server (§7) | ~70% |
| CI | written, never run |

---

## 1. Smart contracts — `contracts/` (Hardhat 3, OpenZeppelin 5.6.1, solc 0.8.28)

### Shared
- [x] `ILevelNFT` interface frozen per §6
- [x] `IForgeCoin` interface (RunResult struct, events, game functions)
- [x] `MockLevelNFT` so Student B can test without Student A's contract
- [x] Ignition deploy module (§6 order: ForgeCoin → LevelNFT → link → grant GAME_ROLE), local deploy verified
- [x] `scripts/export-abi.ts`
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
- [x] `ELEMENTS` registry: all §3.2 elements, with prop descriptors for the editor, `npm run lab:elements`
- [ ] **Multi-player support** in the elements runtime (currently one attached player per Matter world)
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
- [~] Real ABIs from export-abi replacing the hand-written interim ones (integration in progress)
- [~] Hooks for `claimFaucet`, `publish`, `settleRun(WithPermit)`, `buy`/`list` (`useMarket` added)
- [~] Player switched to the game-core controller; scenes switched to the game-core `ELEMENTS`
- [~] API and Colyseus client aligned with the server's real routes and rooms
- [ ] Pages read real indexer/contract data instead of `data/mock.ts`
- [ ] Wallet connect + transactions tested in a browser with MetaMask
- [ ] Read the minted token ID from the publish receipt

### Editor (§3.3)
- [x] Grid, palette (7 categories, 36 elements), place/erase, 100-step undo/redo, T toggles test-play, autosave, JSON import/export
- [~] Property panel driven by the `ELEMENTS` prop descriptors
- [ ] Copy/paste, rotate, link mode (door↔door, switch→blocks)
- [ ] Theme and music picker
- [ ] Publish flow end to end: clear check → thumbnail → IPFS pin → `publish()`

## 5. Server — `server/` (Fastify, Colyseus 0.16, viem, node:sqlite)
- [x] Zod config, `.env.example`
- [x] EIP-712 signer; the test confirms the type strings match `contracts/src` exactly
- [x] Routes: `/levels/pin`, `/levels/clear-proof`, `/runs/validate`, `/levels`, `/levels/:id`, leaderboard, replays, `/ipfs/:cid`, `/health`
- [x] Plausibility checks: speed per tick, checkpoint order, minimum time
- [x] Event indexer (catch-up, then watch, idempotent writes)
- [x] RaceRoom + CoopRoom at 20 Hz, signed RaceResult/RunResult; test with two clients
- [x] 29 tests passing
- [~] Movement constants imported from game-core instead of copies (integration)
- [ ] Join signatures / SIWE mandatory
- [ ] Rate limiting on `/runs/validate`
- [ ] Fetch level JSON from IPFS for levels not pinned through this server
- [ ] Season-signing admin endpoint, persisting race results, reconnect handling

## 6. Integration and operations
- [x] Private GitHub repo: https://github.com/MedSlimane/realmforge
- [x] CI workflow written (`.github/workflows/ci.yml`)
- [ ] CI green on GitHub
- [~] Shared `layoutHash` test vector (web == server)
- [~] Root `README.md` + root scripts: `dev:chain`, `deploy:local`, `dev:server`, `dev:web`, `test`, `build`
- [~] Scripted local end-to-end run: faucet → pin → clear-proof → publish → validate → settleRun → read state
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
