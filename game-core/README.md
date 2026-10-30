# @realmforge/game-core

Standalone strict TypeScript platformer controller, Node-safe replay entry point, and optional Phaser 3 Matter adapter. Original implementation and graphics, MIT. Research and differences from SMB are in [MOVEMENT_RESEARCH.md](docs/MOVEMENT_RESEARCH.md); licenses in [SOURCES.md](SOURCES.md).

```sh
cd game-core
npm ci
npm test
npm run build
npm run lab
npm run lab:build
# Equivalent lab build: npx vite build --config lab/vite.config.ts
```

Controls: arrows/WASD move, Shift/X run, Space/Z jump, down crouches, R resets. The lab includes ground, floating platforms, steps, ice, slime, conveyor, spring, and wall-jump walls. All graphics are colored rectangles.

```ts
import { createControllerState, stepController, EMPTY_INPUT } from '@realmforge/game-core';
let state = createControllerState(30, 100); // reference pixels, not fixed-point
state = stepController(state, {...EMPTY_INPUT, right: true}, {grounded: true});
```

`x`, `y`, `vx`, `vy`, conveyor, platform carry and head correction are integer **1/256 reference pixels**. Positive Y is down. Each call advances exactly one 60 Hz frame. State is copied; inputs and contact objects are never mutated. Provide collision-resolved positions before stepping. The pure controller integrates motion but does not discover or solve level collisions. `createControllerState` takes reference pixel coordinates; use `worldToFixed` / `fixedToWorld` at engine boundaries. Tile size 64 gives scale 4; for 18 px tiles use scale 18/16. Scaling never changes simulation tuning.

```ts
import {createMatterPlayer, installFixedMatterClock} from '@realmforge/game-core/phaserMatter';
// Inside a Phaser Scene with Matter enabled:
installFixedMatterClock(this); // once per scene, all players share the clock
const player = createMatterPlayer(this, 120, 100, {
  tile: 64,
  input: () => currentButtons,
  surface: ground => ({kind: ground?.label === 'ice' ? 'ice' : 'normal'}),
  carry: ground => ({x: 0, y: 0}), // world px/frame; derive from platform displacement
  onStateChange: (next, previous, state) => animate(next)
});
// player.body / player.sensors / player.state / player.setState(next) / player.destroy()
```

Set terrain's collision category to `COLLISION_CATEGORIES.solid` (4). The SPEC names categories but does not assign bit numbers; exported values are player=1, enemy=2, solid=4, oneWay=8, hazard=16, pickup=32, sensor=64. Terrain masks must include player. Sensors query solid/one-way categories and ignore triggers. One-way categories alone do not implement drop-through or conditional collisions: the host level system must filter them. The compound player opts out of world gravity, has infinite inertia (fixed rotation), and zero friction/static friction/air friction. Enemy/hazard/pickup responses belong to the host.

Phaser 3.90 no longer uses `isFixed` internally; the manual clock supplies fixed delta explicitly. The clock disables world auto-update, sets the legacy `runner.isFixed` marker and modern `runner.delta`, and advances 16.6667 ms steps through an accumulator. At most 250 ms of render delta is consumed per render frame; excess time is dropped after stalls. Call only one clock installer per scene. The adapter reads current sensor overlaps each step, validates corner-correction clearance, applies controller velocity including carry/conveyor, then synchronizes collision-resolved position. It does not overwrite collision positions with a second position integration. Destroy/shutdown removes listeners and the body. Crouch keeps the standing hull.

## Tuning

Values below are reference px/frame or px/frame². `MOVEMENT` retains source decimal values; `toFixed` rounds once to the nearest 1/256 increment. Frame timers do not scale.

| Parameter | Reference value | Fixed increment / notes |
|---|---:|---|
| walk / run cap | 1.5 / 2.5 | 384 / 640 |
| walk / run acceleration | 0.037109375 / 0.0556640625 | 10 / 14 |
| release / skid | 0.05078125 / 0.1015625 | 13 / 26 |
| air forward / reverse | 0.037109375 / 0.07421875 | 10 / 19; no passive drag |
| jump row thresholds | 0.5625, 1, 1.5625, 1.75 | absolute takeoff speed |
| launch vy rows | -4, -4, -4, -5, -5 | speed-dependent |
| held rising gravity rows | .125, .125, .1171875, .15625, .15625 | 32, 32, 30, 40, 40 |
| heavy gravity rows | .4375, .4375, .375, .5625, .5625 | 112, 112, 96, 144, 144 |
| max fall / wall slide | 4 / 1 | strict caps |
| coyote / buffer | 6 / 6 frames | coyote: first 6 off-ground frames; buffer includes press frame |
| wall jump | ±2.5, -4.5 | 8-frame steering lock |
| corner correction | ≤4 px | caller must verify clearance |
| stomp / held stomp / spring | -3 / -5 / -7 | helpers return new state |
| ice accel / friction multipliers | .25 / .2 | minimum rounded fixed increments |
| slime speed / friction multipliers | .5 / 3 | ground-only |

Releasing jump latches heavy gravity until the next launch. Reholding cannot recover the high arc. A trailing foot sensor while ascending cannot grant another ground jump. Contradictory left+right cancel. Wall kicks require a fresh press or an unconsumed buffered press. Exposed `MovementState` values: idle, walk, run, skid, jump, fall, crouch, wallSlide, dead.

```ts
import {createReplay, recordInput, simulateReplay} from '@realmforge/game-core';
const log = createReplay();
recordInput(log, currentButtons); // one 6-bit mask per frame, JSON-friendly
const final = simulateReplay(initial, log, (state, frame) => trustedLevel.resolve(state, frame));
```

Replay environment callbacks return `{contacts, surface, resolvedPosition?}` (the optional position contains collision-resolved fixed-point `x`/`y`). Identical inputs, initial state, tuning and collision results produce identical final state. Version 1 logs reject invalid masks/versions. The server must own collision/level resolution, cap replay length and verify level identity; never trust client contacts. Matter itself uses floating point and is not an authoritative deterministic server solver. Headless collision/level validation remains host integration work.
