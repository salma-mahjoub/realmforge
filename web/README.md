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
  contracts/      addresses.ts (env / generated addresses.json), generated/ (ABIs exported by contracts/), hooks/
  data/mock.ts    placeholder data shaped like docs/mockups
  game/
    EventBus.ts   typed React ⇄ Phaser bridge (event map = the contract between both sides)
    PhaserGame.tsx React host (one Phaser.Game per mount)
    main.ts       game factory (RESIZE scale, scenes)
    constants.ts  TILE=64, 60 Hz, registry keys, theme colours
    scenes/       Boot, Preloader, EditorScene, PlayScene, RaceScene
    level/        types.ts (level.v1 format), rle.ts, serialize.ts (canonical JSON + layoutHash), catalog.ts (palette), samples/
    editor/       commands.ts (command pattern, 100-step undo/redo)
    assets/       registry.ts (manifest.json → texture keys), placeholders.ts
    elements/     bridge.ts — level.v1 entities/terrain → game-core ElementDefs (centres, prop sanitising, textures)
    run.ts        run recording: game-core replay masks → input log, trace + checkpoints for the server
  pages/          Home, Browse, LevelDetail, Play, Room, Profile, Market, editor/{EditorPage,Panels,PublishModal}
  web3/           config.ts (wagmi + RainbowKit; chains hardhat 31337 + sepolia), Providers.tsx
```

## Game notes

- **game-core** (`@realmforge/game-core` → `../game-core/src` via Vite alias + tsconfig paths) provides
  the player (`createMatterPlayer`/`stepController`), all 38 SPEC elements (`createElementRuntime`,
  `ELEMENTS[type].create`) and the fixed clock (`installFixedMatterClock`). Element names, editor
  palette and property panel come from `ELEMENT_TYPES` / `ELEMENT_PROPS`.
- **Physics**: Matter, gravity y=2. The world is stepped by game-core's fixed 60 Hz accumulator
  (`world.autoUpdate = false`, exactly 1000/60 ms per step). PlayScene samples input once per step in
  `beforeupdate` (registered before the element runtime and player), records it with game-core's
  `recordInput` (6-bit masks), and records a tile-space trace every 4 frames + checkpoint hits in
  `afterupdate`. `play:finished` carries `run` = the server's `RunSubmission`.
- **Level file**: entities keep integer bottom-left tile anchors (what the editor shows);
  `elements/bridge.ts` converts to game-core tile centres and sanitises props (legacy names such as
  `pendulum`/`conveyor`/`lock_door` and `direction: 'left'` are mapped). Ground runs are merged
  static bodies; other terrain tiles are game-core elements.
- **Assets**: `Preloader` reads `/assets/manifest.json` (schema 1). Missing manifest/files → generated
  placeholder textures, and a 15 s timeout never blocks the game on slow art.
- **Editor**: tools Place/Erase/Select/Link (keys 1–4), ⌘Z / ⇧⌘Z, `G` grid, arrows/right-drag pan,
  `T` toggles test-play from the cursor tile (toolbar button = from the level spawn; only spawn
  clears count for the publish ClearProof). Autosave to `localStorage` every 2 s.
- **Tests**: `npm test` (vitest) — shared layoutHash vectors (`../test-vectors/layout-hash.json`, same
  file as server/), bridge conversion of every sample entity through game-core `normalizeProps`,
  input-log round trip.

## TODO / known gaps

- Race/co-op: the element runtime supports one attached physics player per Matter world; remote
  racers are interpolated sprites only. Countdown/start from the room is not yet gating RaceScene.
- Server has no profile / market listing / activity / earnings endpoints yet → those pages use mocks.
- Ghost replays (`/levels/:id/replays`) are not rendered yet.
