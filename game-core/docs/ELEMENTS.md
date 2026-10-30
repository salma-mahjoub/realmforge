# Level elements

The element layer adds Phaser 3 / Matter factories without changing the controller or its adapter. Imports remain Node-safe (Phaser is a type-only dependency). `ELEMENTS` contains 38 canonical types, including pipe and switch_block. Canonical names use underscores and follow the asset manifest: `question_block`, `one_way`, `semi_solid`, `pendulum_ball`, `conveyor_belt`, `powerup_double_jump`, `powerup_dash`, `locked_door`.

## Factory and coordinates

```ts
const element = ELEMENTS.brick.create(scene,
  {id: 12, type: 'brick', x: 20, y: 8, props: {}},
  {tile: 64, textures: manifest.elements, linkResolver: id => entities.get(id)});
element.update(1); // integer simulation frames, not milliseconds
const json = element.serialize();
element.destroy(); // idempotent
```

Entity x/y are **tile-space centers**; width, height, length, distance, amplitude and path points are tiles. Path coordinates are absolute tile-space centers. Speed is world pixels per frame (angular speed is degrees per frame); direction is signed. Timer and period are frames. Spring launch is positive reference pixels/frame, converted to the controller's negative Y launch. Every descriptor includes name/kind/default, with min/max for numeric fields. `ELEMENT_PROPS[type]` (also `ELEMENTS[type].props`) and `normalizeProps` supply editor defaults and validation. Normalization clones defaults and serialization returns a detached original definition with normalized properties; it does not save transient physics state.

Factories are callable directly as `ELEMENTS[type](scene, def, ctx)` and also expose `.create` for an explicit factory API. Returned instances expose bodies, constraints, enabled, phase, surface, carry, update, activate, setEnabled, destroy and serialize. `activate` is the interaction entry point for a host with its own contact system. `destroy` removes bodies, constraints, images, and shutdown listeners. Switching an element off removes its collision mask, dims its images, and pauses its own AI clock effects. References stay valid after destruction, but destroyed instances cannot activate again.

## Controller integration

```ts
const runtime = createElementRuntime(scene, {
  tile: 64, textures: manifest.elements, input: readInput,
  onEvent: (type, entity) => console.log(type, entity.def.id)
});
for (const def of level.entities) runtime.add(def);
const player = createMatterPlayer(scene, spawnX, spawnY, {
  tile: 64, input: readInput, surface: runtime.surface, carry: runtime.carry
});
runtime.attachPlayer(player);
installFixedMatterClock(scene);
```

Create the runtime **before** the player so its beforeupdate listener updates platform motion and one-way filtering before the controller queries contacts. The runtime calls each element exactly once per Matter step; do not also call update from render events. It owns one attached player. Its afterupdate listener handles pickups, damage and interactions. `runtime.destroy()` removes listeners and all its elements. Scene shutdown also cleans up. Standalone factory callers own update scheduling, input filtering and collision responses.

Ice/slime return controller surface kinds; conveyor speed converts into reference fixed-point surface displacement. Carry uses actual platform displacement plus angular contact-point displacement, including dynamic platforms. Springs call springLaunch; stomps call stompBounce with jump-held input; hazards set MovementState.dead. Down plus a fresh jump drops through one-way/semi-solid platforms for 12 frames; rising players pass through automatically. Filtering temporarily changes the platform's isSensor flag, so this runtime targets a single local player, rather than independent one-way rules for multiple players sharing one Matter world.

Player inventory is available through `inventoryFor(player)`: coins, keys, doubleJump, dash, checkpoint (tile coordinates), goal and teleportCooldown. Power-ups add a fresh airborne jump or a Shift/run-edge dash; landing restores the respective use. Checkpoint/goal emit events and update inventory; respawn and level completion UI remain host responsibilities. Start is a placement marker.

## Behaviors and linking

- Ground, brick, question, ice and slime are static. Rising head contacts destroy bricks or use question blocks once. Question `reward` supports coin, big_coin, key, powerup_double_jump and powerup_dash (unrecognized strings grant one coin).
- Spikes/lava are damage sensors; saw rotates at fixed angular speed. A falling block shakes on top contact, becomes dynamic after timer frames, and damages a player underneath it.
- Crates are pushable bodies. Seesaws use a world hinge, pendulum balls a world tether, and bridges a chain of edge constraints with fixed end segments. Spring tops launch the player; conveyors supply surface displacement.
- Moving platforms traverse waypoints cyclically at constant speed. Default motion is horizontal; elevators default upward. Rotating platforms rotate around their center. Empty paths use distance to generate two waypoints.
- Walkers patrol within four tiles of spawn and reverse at obstacles. Shells become resting shells on stomp, then projectiles on side contact; another stomp stops them. Projectiles destroy other enemies. Flyers follow a deterministic two-axis sine path. Jumpers launch periodically; cannons create gravity-free damaging shots, expiring after 180 frames. No random numbers or wall-clock AI timers are used.
- Coins grant 1, big coins 10, keys 1. Pickups are consumed once. Checkpoints/goal record progress.
- Up enters linked doors/pipes. Link resolution happens at activation, so forward links work. A 30-frame shared player cooldown prevents paired-door loops. Missing targets leave the player in place. Locked doors require and consume one key, remain unlocked, and use the same teleport rules. Place a linked destination center in free space.
- Switches activate on up/down contact with timer debounce. `link` resolves first as an entity ID; otherwise optional groupResolver toggles all instances whose group matches it. The runtime supplies both resolvers. Any solid can be grouped, including switch_block. Cyclic switches are permitted; only immediate targets toggle.

Matter uses floating-point constraints and collision resolution. Fixed 60 Hz and integer-frame AI make repeated runs stable where possible, but this is not a deterministic authoritative server solver.

## Showcase and checks

Run `npm run lab:elements`; N/P moves between stations, R respawns, arrows/WASD move, Space/Z jumps, Shift/X runs/dashes, up enters a door, and down+jump drops through. All 38 elements are in a row, with an additional linked exit and group toggle example. The Vite config serves web/public as publicDir without modifying it. Manifest textures and the green character atlas load from /assets; missing element textures use generated colored images.

`npm test` runs the original controller suite and headless tests using Phaser's actual bundled Matter bodies, constraints, query and engine, with rendering stubbed. Coverage includes registry/default validation, factory cleanup, door/key/cooldown links, switch groups, surfaces, spring/stomp helpers, shell states, hazards, carry, falling timers and runtime drop-through filtering. `npm run build` checks library types; `npm run lab:elements:build` builds the showcase. Browser smoke testing also checks the rendered assets and console.
