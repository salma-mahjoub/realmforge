# Seesaw deck validation — 2026-10-31

## Adapter follow-up — complete

- [x] Reproduce the standalone (480,200) growth defect before editing the adapter; add failing compound-hull and resize-cycle regressions. [Actual pre-fix output](evidence/growth-adapter/regression-before.txt): **5 failed**, including parent x bounds 932…988 instead of 452…508.
- [x] Repair the adapter's compound rebuild; verify feet, hull vertices/bounds, sensors and grown-player collisions on flat and both tilted decks.
- [x] Run the requested game-core/web tests and builds; save browser evidence and document remaining limits.

This follow-up owns only the adapter, focused tests, this document and evidence under `game-core/docs/`. Existing element, asset and web changes are preserved. Shared checklist updates remain with the coordinator because the user explicitly excluded that path.

### Cause and repair

Phaser 3.90's bundled `Body.setParts` auto-hull path calls `setVertices`, which centers the new hull at the parent's **existing position**, then translates it again by the child hull's world-space centroid. This works for a newly created parent at the origin, but rebuilding the positioned player produced a parent hull offset by the old position. Patching just `bounds` would leave incorrect parent vertices for the next physics update.

[`resize` in the adapter](../src/adapters/phaserMatter.ts) now moves the compound to the origin, rebuilds the existing main/sensor parts in local coordinates, calls `setParts`, then places the entire compound at its feet-anchored world position. Parent and child identities remain stable. Collision masks, solid main hull, sensor flags, infinite rotation inertia, controller constants, deck geometry and collision response are preserved.

The anchoring check also found that the previous `main.bounds.max.y` includes Matter's velocity sweep. A falling-player regression demonstrated a **9.75 px** foot displacement during growth, even after the parent-hull repair ([failing output](evidence/growth-adapter/moving-feet-before.txt)). Resizing now anchors to the **physical foot sensor position** instead of the swept AABB. Upward/downward movement and restored state are covered.

After growth at (480,200), actual center is **(480,170)**, main hull bounds **(456,110)–(504,230)**, and parent bounds **(452,106)–(508,234)**, including all sensors. [Pre-fix browser reproduction](evidence/growth-adapter/browser-before.txt) and [final browser results](evidence/growth-adapter/browser-results.json) retain both measurements.

### Final automated verification

Node **v24.21.0**, Phaser **3.90.0**, bundled Matter engine. All four requested commands exited **0** on the final adapter:

| Working directory / command | Actual output | Full log |
|---|---|---|
| `game-core/`: `npm test` | `Test Files 6 passed (6)`; `Tests 83 passed (83)` | [game-core-test.txt](evidence/growth-adapter/game-core-test.txt) |
| `game-core/`: `npm run build` | `tsc -p tsconfig.json` | [game-core-build.txt](evidence/growth-adapter/game-core-build.txt) |
| `web/`: `npm test` | `Test Files 4 passed (4)`; `Tests 18 passed (18)` | [web-test.txt](evidence/growth-adapter/web-test.txt) |
| `web/`: `npm run build` | `tsc --noEmit && vite build`; production bundle built | [web-build.txt](evidence/growth-adapter/web-build.txt) |

The **16 focused adapter regressions** in [adapterGrowth.test.ts](../test/adapterGrowth.test.ts) include the isolated reproduction; three repeated small → big → crouch → stand → small cycles at tiles 32/48/64; damage shrink; upward/downward moving growth at negative coordinates; state restoration; real upper-hull collision rejection before growth and engine separation after growth; and nine grown-rider landing/standing/jump/re-landing cases across flat/±30° decks at tiles 32/48/64. They check current parent **vertices** as well as bounds, sensor dimensions/positions/flags, unchanged filters and stable part identities. Active non-sensor main/deck solver pairs are required for tilted landings. Immediately after resize, bounds must equal the velocity-expanded vertex bounds; after engine resolution they must still enclose current vertices, since Matter updates velocity after swept bounds.

### Final browser evidence

Used the existing lab and its original deck/pivot assets, without changing the lab, geometry or artwork. Chromium **153.0.8010.12** ran the [repeatable browser checker](evidence/growth-adapter/check-browser.js) via the Playwright skill CLI. The checker reloads the page, clicks the actual **Grow / shrink** and **Jump 1 frame** buttons, settles for 360 steps, samples 120 standing steps, jumps, then samples 120 more steps after 180 steps of re-landing. It also runs the full resize sequence while standing on flat and both tilted decks.

```sh
# Launch the existing lab from game-core/ as documented below, then from repo root:
playwright-cli --session growth-adapter open http://127.0.0.1:5178/docs/seesaw-lab.html --config game-core/docs/playwright.seesaw.json
playwright-cli --session growth-adapter run-code "$(cat game-core/docs/evidence/growth-adapter/check-browser.js)"
```

| Grown rider scenario | Standing foot contacts | Maximum standing penetration | Standing x/y range | Jump vy (fixed) | Re-landing foot contacts |
|---|---:|---:|---|---:|---:|
| [Flat](evidence/growth-adapter/grown-rest.png) / [jump](evidence/growth-adapter/jump-rest.png) | 120/120 | 0 px | 0 / 0 px | −1024 | 120/120 |
| [Left −30°](evidence/growth-adapter/grown-left.png) / [jump](evidence/growth-adapter/jump-left.png) | 120/120 | 0.050 px | 0 / <0.000001 px | −1024 | 120/120 |
| [Right +30°](evidence/growth-adapter/grown-right.png) / [jump](evidence/growth-adapter/jump-right.png) | 120/120 | 0.050 px | 0 / 0 px | −1024 | 120/120 |
| [Off-center fall](evidence/growth-adapter/grown-fall.png) / [jump](evidence/growth-adapter/jump-fall.png) | 120/120 | 0 px | 0 / 0 px | −1024 | 120/120 |

All sampled final states contain the main hull within the parent bounds. Jump takeoff clears foot contact. Resize-cycle feet differ by at most **1.14 × 10⁻¹³ px** across the five phases, with foot contact and valid parent bounds throughout. Hinge error is **0 px**; captured console errors and page exceptions are **0**. Flat standing, right-tilted standing and left-tilted jump screenshots were visually inspected. [Raw checks](evidence/growth-adapter/browser-checks.txt) and [structured results](evidence/growth-adapter/browser-results.json) include the measurements.

### Remaining limits

- A centered jump's landing impulse can rotate the free hinge: the initially flat browser case ends at **3.9516°**, with **1.859375 px** horizontal carry across the final 120 steps. Foot contact remains 120/120 with zero penetration and correct bounds. This follow-up does not certify motionless rest after that impact or change the seesaw's response. Both tilted-stop cases settle without measured drift.
- Sensor-driven grounding can arrest a short fall before a useful main-body impact, as described in the original validation below; the tilted landing regressions require actual solver contacts. The adapter does not impose continuous player weight.
- Browser proof uses the lab's diagnostic player hull, not the complete web gameplay/animation flow. Matter remains floating point; this is not proof of cross-platform replay determinism. The elements runtime's one-player-per-world limit remains.
- No dependencies, assets, controller, seesaw geometry, contract/server code, shared checklist, or existing lab code were changed. No commit was made.

The sections below preserve the original element-only validation and its pre-fix diagnostics; the adapter results above supersede its pending growth limitation.

This pass owns only `src/elements/`, `test/elements/`, this documentation, and an additive README note. No controller, adapter, web, asset, shared checklist or AGENTS edits were made. No dependencies or artwork were added. No commits or pushes were made.

## Dimensions and behavior

The physical and visible deck now use **0.45 × configured height × tile** instead of 0.25. Length remains `width × length × tile`. A default four-tile plank at tile 64 is **256 × 28.8 px**; the six-tile validation fixture is **384 × 28.8 px**. Entity x/y still specify the axle center. The zero-length world constraint retains stiffness 1 and local anchor (0,0).

`configureSeesaw` preserves the mass and moment of inertia of the previous quarter-height rectangle. With the six-tile fixture these are **6.144** and **302514.176** in Matter units. Increasing the collision area therefore does not silently increase weight or resistance to angular acceleration. Friction, collision categories, controller constants, player hulls and carry integration are unchanged. Other quarter-height elements retain their existing dimensions.

The inspected baseline had **no angular stops**: a center hinge alone allows complete revolutions. This pass adds **±30° stops**, tested in both directions, before/after fixed physics steps. Only outward angular velocity is removed at a stop; inward motion remains free. There is no restoring motor or added damping. Shutdown removes both limit listeners. This is an explicit behavior addition, not a claim that a previous bound was preserved.

The existing deck renderer stretches the sprite to the actual body dimensions. Hosts can optionally provide `ctx.textures.seesaw_pivot`; that image stays fixed at the axle x, top at axle y + 0.1 tile, with default size 0.75 × 0.75 tile, behind the rotating deck. It dims and cleans up with the element. The web currently supplies its pivot through `drawMechanisms`, and does not supply the optional core pivot, so these changes do not add a second web pivot. Its existing placement matches this convention. The browser fixture supplies the separate pivot to the core factory.

The fixture uses the `elements.seesaw` and `elements.seesaw_pivot` imagery of the bundled CC0 pack (see [assets/CREDITS.md](../../assets/CREDITS.md)).

## Consequences for existing levels

No level JSON, coordinates, props, canonical hashes or migrations change. At rest the surface rises **0.1 × configured height × tile** and the underside descends by the same amount: **6.4 px each** for height 1 and tile 64. Creators should retest adjacent ledges, overhead/under-deck clearance, initial spawn intersections and the plank's swept volume. At tilt, the extra clearance is measured along the deck's local normal. Levels relying on unrestricted rotations now stop at ±30° and need a playthrough. Increasing `height` continues to scale the physical thickness; it is not a new absolute pixel setting.

The controller disables player gravity and uses sensor contacts to stop falls. A very short drop can settle the foot sensor before a collision transfers a useful impulse; a player idling off-center is not a continuous physical weight. This existing behavior is unchanged. The landing regression starts a full-tile fall and proves real contact-driven rotation, angular carry and a stable stop; it does not pretend every small step tips the plank.

## Automated verification

Run from `game-core/`, Node **v24.21.0**. All commands below exited **0**; raw output is saved under [evidence/](evidence/).

| Command | Actual result / output |
|---|---|
| `npm test` | **67 passed**, 5 files; [full log](evidence/npm-test.txt) |
| `npm run build` | TypeScript passed; [log](evidence/npm-build.txt) |
| `npm run lab:build` | Vite built; [log](evidence/lab-build.txt) |
| `npm run lab:elements:build` | Vite built; [log](evidence/elements-lab-build.txt) |
| `npm run typecheck:lab` | TypeScript passed; [log](evidence/lab-typecheck.txt) |
| `npx vite build --config docs/seesaw-lab.vite.config.ts` | Fixture built; [log](evidence/seesaw-lab-build.txt) |

Both original labs and the fixture emit Vite's existing warning about the Phaser bundle exceeding 500 kB. The fixture was also checked with `npx tsc --noEmit --moduleResolution bundler --module esnext --target es2022 --strict --skipLibCheck docs/seesaw-lab.ts` (exit 0).

The **14 new regressions** in [seesaw.test.ts](../test/elements/seesaw.test.ts) exercise Phaser 3.90's actual bundled Matter engine and the production player adapter: collision/render dimensions at tiles 32/48/64 with non-default width/height, mass/inertia, hinge anchors and cleanup, the separate fixed pivot, unchanged other platform dimensions, both angular stops with inward release, 300 resting steps, unchanged growth/shrink state and foot anchoring, 360-step tilted landings in both directions at tiles 32/64, shallow penetration, sustained foot contacts, jump takeoff and contact/carry during a moving-plank landing. Growth collision behavior has the limitation below; it is not certified by the foot-anchoring test.

## Browser evidence

Launch the fixture from `game-core/`:

```sh
npx vite --config docs/seesaw-lab.vite.config.ts
# Open http://127.0.0.1:5178/docs/seesaw-lab.html
```

The fixture starts paused and can be stepped or played with arrows/Shift/Space. The visible deck, Matter outline, main hull, foot sensor and hinge marker can be compared directly. The original labs remain unmodified. The optional local [Playwright configuration](playwright.seesaw.json) names the already installed macOS Chromium executable used here; change that path for another machine. Browser automation uses the Playwright skill CLI, with [check-seesaw-browser.js](check-seesaw-browser.js) passed to `run-code`.

Actual browser: **Chromium 153.0.8010.12**, Phaser **3.90.0**. [Raw checks and diagnostics](evidence/browser-checks.txt) include all sampled values and assertions; [browser-results.json](evidence/browser-results.json) provides the same result as structured data. Each scenario settles for 360 steps, then samples 120 more. Console errors and page exceptions collected over the final reload/check run: **0**. The actual UI's “Jump 1 frame” button was also clicked from settled rest: fixed-point vy became **−1024** and foot contact became false.

| Scenario | Foot contacts | Max penetration | Vertical/horizontal range | Hinge error | Jump vy (fixed) |
|---|---:|---:|---|---:|---:|
| [Rest](evidence/seesaw-rest.png) | 120 / 120 | 0 px | 0 / 0 px | 0 px | −1024 |
| [Left −30°](evidence/seesaw-left.png) | 120 / 120 | 0.050 px | < 0.000001 / 0 px | 0 px | −1024 |
| [Right +30°](evidence/seesaw-right.png) | 120 / 120 | 0.050 px | 0 / 0 px | 0 px | −1024 |
| [Off-center landing](evidence/seesaw-fall.png) | 120 / 120 | 0 px | 0 / 0 px | 0 px | −1024 |

Screenshots were captured from the live Phaser canvas; the right-tilt screenshot was visually inspected. The small rider is stable at rest, on the stops and during the tested tilt transition. Matter remains floating point, and these results do not establish authoritative cross-platform replay determinism.

## Growth collision defect — historical pre-fix reproduction

**Resolved by the adapter follow-up above.** The following measurements describe the original failure and are retained as reproduction evidence.

Additional big-form tests exposed incorrect **parent broadphase bounds after `createMatterPlayer.setForm('big')`**. A standalone player, independent of any seesaw, created at (480,200) and then grown has center (480,170), main bounds approximately **(456,110)–(504,230)**, but parent bounds **(932,306)–(988,434)**. The parent no longer contains the main hull. The browser checker reproduces this with an isolated second player that is never attached to the element runtime. This is evidence of an adapter resize issue, not an inference from the seesaw sprite.

On the right-tilt fixture that grown player can retain a foot contact while its main hull penetrates **4.468 px**; see [diagnostic screenshot](evidence/seesaw-growth-diagnostic.png). Big-form slope collision/stability is therefore **not fully verified**. Existing feet-anchored resize/state tests still pass. `src/adapters/phaserMatter.ts` and `src/controller.ts` have no diff in this pass. Repairing the broadphase hull belongs to the adapter owner and must be followed by real grown-rider collision tests on both tilt directions. No adapter workaround or altered growth behavior was added here.
