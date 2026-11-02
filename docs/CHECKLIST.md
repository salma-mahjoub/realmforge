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
| CI | green (4 jobs) |

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
- [~] `it.todo` integration tests from §11: 5 of 9 done (setActive→LevelInactive, 4-player race, closeSeason ×2; token-cap clipping covered at unit level); left: remix-of-remix (A), reentrancy (A), gas, Slither
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
- [x] Resolve 6× `TODO(studentB)` design decisions (6/6 done: self-play earns no reward; coins bonus 0.1/coin, capped at 5; half of the treasury cut is burned; faucet daily budget of 10,000 FORGE; season ranking rules in `docs/SEASONS.md`; RaceResult carries a deadline)
- [ ] Later: replace the faucet daily budget by a server-signed claim (new EIP-712 type + per-IP limit), keeping the budget as a second layer
- [ ] Implement the season scoring from `docs/SEASONS.md` in the indexer + a season-signing endpoint
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
- [x] **Mario pack (NSMBU style, default)** `web/public/packs/mario/`: 117/117 element IDs, 21 parallax layers over 4 themes, validator passes (`assets/packs/mario`). Private class demo only, see AGENTS.md.
- [x] Pack switch (`VITE_ASSET_PACK` + in-game Art toggle), Kenney as fallback
- [x] Parallax backgrounds, body-sized sprites (character 60 px, ~22 tiles visible), state animations, ground auto-tiling, editor zoom + sprite thumbnails
- [x] High-resolution asset pass: scale audit reduced 50 violations to 0; padded terrain atlases and 47 neighbour masks per theme. Audit: `assets/packs/mario/AUDIT.md`.
- [x] Genuine 16-frame coin and 13-frame 10-coin animations; authentic locked-door texture; scale audit now measures opaque content, not padded canvas
- [x] Downloaded Goomba integration: final entry-by-entry manifest merge after source rebuild; 16 walk / 14 already-flattened stomp frames; uniform source aspect and bottom-center feet; full animation completion with static Kenney fallback. Regression tests and real keyboard/Matter browser evidence: `docs/screenshots/goomba/`.
- [ ] Exact NSMBU fidelity: Luigi and small Mario still use NSMB Wii fallbacks; skid/wall-slide poses, Paragoomba cycles, spring, checkpoint and goal states are stills or substitutes. Sources searched and blockers: `assets/packs/mario/RESOLUTION_REPORT.md`.
- [x] Seesaw pivot/visual scaling and terrain edge-mask/padding fixes; screenshots in `docs/screenshots/`.
- [x] Seesaw deck 0.45 tile thick with matching art, centre hinge, ±30° stops; 14 regressions + browser evidence (`game-core/docs/SEESAW_VALIDATION.md`)
- [x] Growth collision fix: rebuilt compound body no longer offset by the old position; feet anchored to the foot sensor; 16 adapter regressions (`game-core/test/adapterGrowth.test.ts`)
- [ ] A hard centred landing by big Mario leaves the seesaw tilted ~4° (no restoring force); contact stays solid
- [x] Small/big forms: feet-anchored hull resize, ceiling-safe crouch growth, mushroom pickup, big-only brick breaking, shrink on damage and 90-frame invulnerability; replay tests. Kenney mushroom is the genuine CC0 Kenney asset.

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
- [x] CI green on GitHub (all 4 jobs; server job builds game-core first)
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

## Latest verification — visual/player-form pass

Coordinator re-ran root `npm test` and `npm run build`: game-core 53, contracts 42 (+9 todo), server 31, web 18 passing; all builds pass. Captures use a separate render-polish fixture, not the canonical hash-vector level.

## Latest verification — fidelity/seesaw/growth pass

Coordinator re-ran root `npm test` and `npm run build`: game-core 83, contracts 42 (+9 todo), server 31, web 18 passing; all builds pass. Mario pack validator: all checks PASS (118/118 element IDs, 12.0 MB / 25 MB budget).

## Art, animation and UI/UX pass (31/10/2026)

### UI/UX (Opus)
- [x] Design system: tokens, Outfit + Inter fonts, lucide icons, reusable components (Button, Card, Modal with focus trap, Toast, Tabs, Tooltip, Skeleton, EmptyState, AddressChip, TokenAmount)
- [x] All pages redesigned to mockup fidelity: Home, Browse (tabs, search, filters), Level detail + market dialogs, Market, Profile, Play (pre-run card, pause, game-over, cleared + 3-step settle), Race lobby + countdown, Editor chrome (icon toolbar, shortcuts overlay, palette search with sprite thumbnails, publish pre-flight + progress rail)
- [x] Wallet UX: wrong-network banner with switch, missing-contracts / chain-down / server-offline banners, transaction toasts (confirm → pending → confirmed/failed) with readable contract errors, buttons disabled while pending, sample-data badges
- [x] Loading/empty/error states, responsive to 820 px and 390 px, skip link, focus rings, ARIA, reduced motion; 41 screenshots in `docs/screenshots/ui/`
- [x] Faucet verified end to end in a browser against Hardhat (0 → 100 FORGE)
- [ ] Full mint and settleRun clicked through the UI with a real level clear
- [ ] Server endpoints for profile, listings, activity and earnings (pages still on sample data)
- [ ] Race lobby: real ready/finish state from Colyseus; live ranking
- [ ] Indexer keeps stale data after a Hardhat restart (UI shows "Not found on this chain")
- [ ] "Art" pack picker overlaps the canvas; editor is read-only on phones

### Animation and VFX
- [x] Speed-driven character animation, skid/turn, squash and stretch, grow/shrink, death hop, invulnerability blink
- [x] Gameplay-tied objects: spring, ? block bump, brick debris, coin pop + score, checkpoint, goal sequence with iris, P-switch, donut, cannon, stomp poof, shell spin
- [x] FX: skid/run dust, landing puff, camera shake, level intro card, iris transitions; pooled particles, 58 FPS measured on `/play/1`; screenshots in `docs/screenshots/vfx/`
- [x] EventBus: `play:pause/resume/restart`, `play:state`, `play:finished`, `play:died`
- [ ] Mushroom popping out of ? blocks needs a gameplay change in game-core

### Mario pack art
- [x] 15 animated/still objects + 3 FX (coin_pop, star, brick_debris) published under `web/public/packs/mario/objects/`; 10 genuine animation cycles; validator structural checks pass
- [ ] Spring compress, active checkpoint, waving goal, lava animation, dust/land-puff sprites: sources blocked (procedural fallbacks active)
- [x] Downloaded Nintendo/DogToon64 Mario + Luigi archives safely extracted and inspected: 24 DAE models, 86 source files, 18 reproducible bind-pose PNGs. Preserve as inspection evidence only (`assets/packs/mario/character-model-import/MODEL_REPORT.md`); no gameplay animation mapping.
- [ ] **Exact NSMBU character animation remains blocked: no original clips.** All 24 downloaded DAE files contain zero animation/clip/channel/sampler elements. Compatible original timed clips plus a verified evaluator are still needed for all four standard forms. Current player art stays active; full pack fidelity gate still fails on short cycles and Wii/pose fallbacks.

Verification: root `npm test` + `npm run build` — game-core 83, contracts 42 (+9 todo), server 31, web 39, all builds pass.


## Goomba integration verification — 1 November 2026
- [x] Final source-first pack build and entry-by-entry Goomba merge; all unrelated manifest entries, aliases, completed objects and model previews preserved. Two real rebuilds plus native aspect/PNG-encoding regressions: 19 pack tests.
- [x] Display-only changes: web artwork preparation preserves the 120×100 walker canvas; runtime stomp uses animation completion/duration without extra flattening; static Kenney fallback retained. Game-core 87 tests + build; web 40 tests + production build.
- [x] Actual keyboard-driven PlayScene/Matter stomp on the saved local fixture: all 16 walk and 14 stomp frames observed, uniform 0.64 scale and bottom-center feet, ~587 ms completion. Screenshots, 1.66-second browser GIF and raw observations: `docs/screenshots/goomba/`.
- [x] Goomba import exact-RGBA/hash/atlas validation and real web registry checks pass. All 214 pre-existing uncommitted import/model files preserved byte-for-byte; model validator passes (18 stills, no original clips).
- [ ] Full pack validator still has a pre-existing publication byte-check failure when its object prepare step re-encodes PNGs differently. The focused builder verifies exact decoded RGBA plus atlas bytes without rewriting published art. Exact character fidelity remains open: original compatible Mario/Luigi clips are absent; short cycles, Wii/pose fallbacks and Paragoomba motion remain unresolved.

## Downloaded Goomba and model-import follow-up

- [x] Downloaded SMM2 NSMBU Goomba sheet (Nintendo; ripped by DogToon64) integrated reproducibly: 16 walk and 14 stomp frames, uniform source-native scaling and feet anchors; no extra squash or 220 ms truncation.
- [x] Real keyboard/Matter gameplay captures in `docs/screenshots/goomba/`: all frames observed, stomp completes in about 587 ms.
- [x] Mario/Luigi downloaded ZIPs inspected and rendered for inspection: 18 transparent previews, original ZIP/source hashes and reproducible pipeline in `assets/packs/mario/character-model-import/`.
- [ ] Original Mario/Luigi animation clips still missing: all 24 downloaded model files have no animation channels. Inspection renders are not used as player animations.

Coordinator verification: game-core 87, contracts 42 (+9 todo), server 31, web 40 tests pass; root production build passes. Pack structural validation passes; strict character-fidelity checks intentionally remain failing for documented fallback poses/short cycles. Original downloads are untouched.

## Camera/background regression — 1 November 2026
- [x] Reproduced before edits in real Chromium with keyboard input on `/play/1` and editor test-play, Mario/Kenney. Fixed physical camera target + grounded jump baseline/vertical velocity look-ahead, swept-bounds sprite sizing, same-render parallax and fractional-zoom rounding/backing sizes. Verified flat walk/run/jump/land/reverse, physical slopes, tall falls/springs, growth, pause/resume, editor return/zoom/pan and resize. 20 recorded trajectories (11,538 frames); 16 patched trajectory assertions pass. Web 50 tests + build, game-core 87 tests + build pass. Evidence, raw telemetry and full command output: `docs/screenshots/camera-fix/README.md`. No physics changes or commit/push.
