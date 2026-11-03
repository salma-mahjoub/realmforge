# RealmForge

A browser "Mario Maker"-style platformer: build levels with rich Matter.js physics, publish them as
ERC-721 NFTs, and earn the ERC-20 **FORGE** token when others play them. Gameplay runs off-chain;
the chain handles ownership, the economy and settlement through server-signed EIP-712 results.

- Spec: [docs/SPEC.md](docs/SPEC.md) (PDF: [docs/RealmForge_Spec.pdf](docs/RealmForge_Spec.pdf))
- UI mockups: [docs/mockups/](docs/mockups/) (browse, editor, gameplay, race, publish, level/market)
- Ownership: [OWNERSHIP.md](OWNERSHIP.md)

## Architecture

```
 Browser (web/)                                 server/                          chain (contracts/)
 React + wagmi/RainbowKit ── viem RPC ─────────────────────────────────────────► LevelNFT  (ERC-721)
 Phaser 3 + Matter                                                              ForgeCoin (ERC-20)
   └─ game-core (player controller,      ── HTTP ──► Fastify API :8787               ▲
      38 level elements, fixed 60 Hz,                 pin level JSON (IPFS/local)     │ events
      replay input masks)                             validate runs → EIP-712 sigs    │
                                         ── WS ───► Colyseus :2567 (race / coop)      │
                                                      indexer (viem) → SQLite ◄───────┘
```

Publish: editor test-play (clear from spawn) → `POST /levels/pin` (layoutHash = keccak256 of the
canonical level JSON) → `POST /levels/clear-proof` (server re-checks the run, signs `ClearProof`) →
`LevelNFT.publish`. Play: `/play/:id` → `POST /runs/validate` (signed `RunResult`) →
`ForgeCoin.settleRun` (approve) or `settleRunWithPermit` (ERC-2612, `uint8 v`).

## Packages

Four standalone npm packages (own `package.json` + lockfile, **no workspaces**). The root
`package.json` only holds convenience scripts.

| Package | Stack | What | Tests |
|---|---|---|---|
| [contracts/](contracts/README.md) | Hardhat 3, Solidity 0.8.28, OpenZeppelin 5, Ignition, viem | `LevelNFT` (levels, market, royalties, ClearProof) · `ForgeCoin` (faucet, runs, races, seasons) · `scripts/export-abi.ts` | Solidity unit/fuzz + node:test integration |
| [game-core/](game-core/README.md) | strict TS, optional Phaser 3 Matter adapter | Mario-like controller (`stepController`), `createMatterPlayer`, fixed clock, replay bitmask encoder, `ELEMENTS` registry of all SPEC elements ([docs](game-core/docs/ELEMENTS.md)) | vitest (headless Matter) |
| [server/](server/README.md) | Fastify 5, Colyseus 0.16, viem, node:sqlite, zod | level pinning, run plausibility (constants from game-core), EIP-712 signer, event indexer, race/co-op rooms | vitest |
| [web/](web/README.md) | Vite, React 19, Phaser 3.90 (Matter), wagmi/RainbowKit | pages, editor, play/race scenes built on game-core, contract hooks on generated ABIs | vitest + `tsc` |

Shared fixtures: [test-vectors/layout-hash.json](test-vectors/layout-hash.json) — canonical-JSON /
`layoutHash` vectors checked by both `server/` and `web/` test suites. Assets: `assets/` (sources)
and `web/public/assets/` (`manifest.json`, CC0 Kenney art).

## Quickstart (local chain)

Requires Node ≥ 22.13.

```bash
npm run setup            # npm ci in game-core, contracts, server, web
npm run dev:chain        # terminal 1 — Hardhat node on :8545 (chain 31337)
npm run deploy:local     # terminal 2 — build + Ignition deploy + export ABIs + write web/.env.local & server/.env
npm run dev:server       # terminal 2 — API :8787 + Colyseus :2567 + indexer
npm run dev:web          # terminal 3 — http://localhost:8080
npm run e2e:chain        # optional — scripted faucet → pin → clear-proof → publish → validate → settle flow
```

MetaMask: add network `http://127.0.0.1:8545` (chain id 31337) and import a Hardhat test account.
The server signs with Hardhat account #1 (public dev key from `server/.env.example`; never use it
outside a local chain). `deploy:local` resets the Ignition journal for chain 31337, so re-run it
after every `dev:chain` restart.

| Script | Does |
|---|---|
| `npm run setup` | `npm ci` in every package |
| `npm run dev:chain` / `deploy:local` | local chain / deploy + ABIs + env files |
| `npm run dev:server` / `dev:web` | builds game-core, then server dev (tsx watch) / Vite dev server |
| `npm test` | game-core, contracts, server, web test suites |
| `npm run build` | game-core `tsc`, contracts compile, server `tsc`, web `tsc` + `vite build` |
| `npm run typecheck` | server + web type-check |
| `npm run e2e:chain` | `server/scripts/e2e-chain-flow.ts` against the running stack |

## Team

| | Student A | Student B |
|---|---|---|
| Contract | `LevelNFT.sol` (ERC-721) | `ForgeCoin.sol` (ERC-20) |
| Product area | publish flow + market UI | play / race settlement |

Details: [OWNERSHIP.md](OWNERSHIP.md).
