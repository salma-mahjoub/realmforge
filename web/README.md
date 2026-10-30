# RealmForge — web

Browser DApp for RealmForge (see `../docs/SPEC.md`): React shell + Phaser 3 (Matter.js) game +
wagmi v2 / viem / RainbowKit wallet. Standalone npm package (Node ≥ 22).

Bootstrapped from [`phaserjs/template-react-ts`](https://github.com/phaserjs/template-react-ts)
(MIT, © Phaser Studio Inc — notice kept in `LICENSE.template-react-ts`). Changes vs. the template:
Phaser pinned to **3.90** (template now ships Phaser 4), single `vite.config.ts`, the template's
`log.js` telemetry ping removed, React Router + wallet providers added.

## Scripts

```bash
npm install
cp .env.example .env.local   # fill contract addresses / service URLs
npm run dev                  # http://localhost:8080
npm run build                # tsc --noEmit && vite build  -> dist/
npm run typecheck            # tsc --noEmit
```

## Routes (SPEC §3.7)

| Path | Page |
|---|---|
| `/` | Home: hero, how it works, trending levels |
| `/browse` | Level browser — sort New/Popular/Hardest, search, creator + theme filters |
| `/level/:id` | Details: preview, plays/clears/best time, ownership + buy, creator earnings, leaderboard, recent txs |
| `/editor` | Level editor (EditorScene) — palette, toolbar, property panel, publish modal |
| `/play/:id` | Solo play (PlayScene) with HUD, restart/pause, run submission → `settleRun` |
| `/room/:code` | Versus race lobby + RaceScene (`/room/new` = create/join form) |
| `/profile/:address` | Balance, faucet, created / owned levels, recent clears |
| `/market` | NFT listings |

Read endpoints fall back to bundled mock data (`src/data/mock.ts`) when the API is down and
`VITE_USE_MOCKS` ≠ `false`; write endpoints never fake success.

## Layout

```
src/
  api/            client.ts (Fastify API, VITE_API_URL), colyseus.ts (VITE_GAME_SERVER_URL), types.ts
  components/     Layout (nav, FORGE pill, wallet chip), ui (cards, thumbs, formatters), useAsync
  contracts/      addresses.ts (env), abi.interim.ts, generated/ (ABIs from contracts/), hooks/
  data/mock.ts    placeholder data shaped like docs/mockups
  game/
    EventBus.ts   typed React ⇄ Phaser bridge (event map = the contract between both sides)
    PhaserGame.tsx React host (one Phaser.Game per mount)
    main.ts       game factory (RESIZE scale, scenes)
    constants.ts  TILE=64, 60 Hz, registry keys, theme colours
    scenes/       Boot, Preloader, EditorScene, PlayScene, RaceScene
    level/        types.ts (level.v1 format), rle.ts, serialize.ts (canonical JSON + layoutHash), catalog.ts (palette), samples/
    editor/       commands.ts (command pattern, 100-step undo/redo)
    player/       PlayerAdapter.ts (seam for game-core; temporary Matter player)
    assets/       registry.ts (manifest.json → texture keys), placeholders.ts
    elements/     ← owned by elements-runtime (Matter level elements), not by this package's author
  pages/          Home, Browse, LevelDetail, Play, Room, Profile, Market, editor/{EditorPage,Panels,PublishModal}
  web3/           config.ts (wagmi + RainbowKit; chains hardhat 31337 + sepolia), Providers.tsx
```

## Game notes

- **Physics**: Matter, gravity y=2, `runner: { fps: 60 }`. Phaser 3.90 bundles Matter 0.20 whose
  runner is always a fixed-delta accumulator (the `isFixed` flag from SPEC §3.1 no longer exists).
  The controller is stepped from Matter's `beforeupdate`, i.e. once per 60 Hz physics step, and the
  input log (`[frame, buttons]`, SPEC §3.6) is recorded at that rate.
- **Assets**: `Preloader` reads `/assets/manifest.json` (schema 1 from asset-pipeline: `elements`,
  `characters`, `enemies`, `themes`, `sfx`). Missing manifest/files → generated placeholder
  textures, and a 15 s timeout never blocks the game on slow art.
- **Editor**: tools Place/Erase/Select/Link (keys 1–4), ⌘Z / ⇧⌘Z, `G` grid, arrows/right-drag pan,
  `T` toggles test-play from the cursor tile (Esc/T returns, undo stack survives). Autosave to
  `localStorage` every 2 s; JSON import/export in the header.
- **`@realmforge/game-core`** is aliased to `../game-core/src` (Vite + tsconfig paths) but not
  imported yet — swap `TemporaryMatterPlayer` in `src/game/player/PlayerAdapter.ts`.

## TODO / integration points

- Replace `PlayerAdapter` internals with `createMatterPlayer`/`stepController` from game-core.
- Replace `PlayScene.spawnEntity` stand-ins with the factory from `src/game/elements/`.
- Point `src/contracts/generated/index.ts` at generated ABIs; delete `abi.interim.ts`.
- Align `src/api/client.ts` routes and `src/api/colyseus.ts` room/message names with `server/`.
- Wire `LevelNFT.buy` / `list`, parse `LevelPublished` id after mint, `settleRunWithPermit`.
