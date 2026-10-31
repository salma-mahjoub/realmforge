import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
import {createMatterPlayer} from '../src/adapters/phaserMatter.js';
import {EMPTY_INPUT} from '../src/input.js';
import {COLLISION_CATEGORIES as C, worldToFixed} from '../src/constants.js';
import {createElementRuntime} from '../src/elements/index.js';
import {SEESAW} from '../src/elements/seesaw.js';
import {matterHarness, Bodies, Body, Composite, Query} from './matterHarness.js';

const require = createRequire(import.meta.url);
const Bounds = require('phaser/src/physics/matter-js/lib/geometry/Bounds.js');
const Constraint = require('phaser/src/physics/matter-js/lib/constraint/Constraint.js');
type Player = ReturnType<typeof createMatterPlayer>;

/** Check actual vertices, not just a patched AABB. Matter expands bounds by velocity. */
function expectCurrentCompound(player: Player, width: number, height: number, afterEngine = false) {
  const {body, sensors} = player, main = body.parts[1]!;
  const envelope = Bounds.create(body.parts.slice(1).flatMap(part => part.vertices));
  const hull = Bounds.create(body.vertices);
  for (const edge of ['min', 'max'] as const) for (const axis of ['x', 'y'] as const) {
    expect(hull[edge][axis], `parent hull ${edge}.${axis}`).toBeCloseTo(envelope[edge][axis], 7);
  }
  for (const part of body.parts) {
    const expected = Bounds.create(part.vertices);
    Bounds.update(expected, part.vertices, body.velocity);
    for (const edge of ['min', 'max'] as const) for (const axis of ['x', 'y'] as const) {
      if (!afterEngine) expect(part.bounds[edge][axis], `${part.label} bounds ${edge}.${axis}`).toBeCloseTo(expected[edge][axis], 7);
      // The solver changes velocity after updating swept bounds. They must
      // still enclose the current vertices, even when that velocity differs.
      const vertices = Bounds.create(part.vertices);
      expect(part.bounds.min[axis]).toBeLessThanOrEqual(vertices.min[axis] + 1e-7);
      expect(part.bounds.max[axis]).toBeGreaterThanOrEqual(vertices.max[axis] - 1e-7);
    }
    expect(part.parent).toBe(body);
    expect(part.collisionFilter).toEqual(body.collisionFilter);
  }
  const mainHull = Bounds.create(main.vertices);
  expect(mainHull.max.x - mainHull.min.x).toBeCloseTo(width);
  expect(mainHull.max.y - mainHull.min.y).toBeCloseTo(height);
  expect(main.isSensor).toBe(false);
  expect(body.isSensor).toBe(false);
  expect(body.collisionFilter.category).toBe(C.player);
  expect(body.inertia).toBe(Infinity);
  expect(body.ignoreGravity).toBe(true);
  expect(body.position.x).toBeCloseTo(main.position.x);
  expect(body.position.y).toBeCloseTo(main.position.y);
  expect(sensors.foot.position.y).toBeCloseTo(mainHull.max.y);
  expect(sensors.head.position.y).toBeCloseTo(mainHull.min.y);
  expect(sensors.left.position.x).toBeCloseTo(mainHull.min.x);
  expect(sensors.right.position.x).toBeCloseTo(mainHull.max.x);
  for (const [name, sensor] of Object.entries(sensors)) {
    expect(sensor.isSensor).toBe(true);
    const bounds = Bounds.create(sensor.vertices), scale = width / 12;
    const horizontal = name === 'foot' || name === 'head';
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(horizontal ? width - 4 * scale : 2 * scale);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(horizontal ? 2 * scale : height - 4 * scale);
  }
}

describe('adapter form resize compound broadphase', () => {
  it('reproduces isolated growth at (480,200) with a parent hull enclosing all parts', () => {
    const h = matterHarness(), player = createMatterPlayer(h.scene, 480, 200);
    player.setForm('big');
    console.info('isolated growth:', JSON.stringify({position: player.body.position, parent: player.body.bounds, main: player.body.parts[1]!.bounds}));
    expectCurrentCompound(player, 48, 120);
    expect(player.body.position.y).toBeCloseTo(170);
    expect(player.body.parts[1]!.bounds.max.y).toBeCloseTo(230);
    h.scene.events.emit('shutdown');
  });

  it.each([32, 48, 64])('keeps feet, part identities, sensors and current hull through small → big → crouch → stand → small at tile %i', tile => {
    const h = matterHarness(); let input = {...EMPTY_INPUT};
    const player = createMatterPlayer(h.scene, 480, 200, {tile, input: () => input});
    const parts = [...player.body.parts], feet = player.body.parts[1]!.bounds.max.y;
    h.solid(480, feet + 32, 500, 64);
    const check = (height: number) => {
      expectCurrentCompound(player, tile * 12 / 16, height);
      expect(player.body.parts[1]!.bounds.max.y).toBeCloseTo(feet, 7);
      player.body.parts.forEach((part, index) => expect(part).toBe(parts[index]));
      expect(player.state.y).toBe(worldToFixed(player.body.position.y, tile / 16));
    };
    check(tile * 15 / 16);
    for (let cycle = 0; cycle < 3; cycle++) {
      player.setForm('big'); check(tile * 30 / 16);
      input = {...EMPTY_INPUT, down: true}; h.world.emit('beforeupdate');
      expect(player.state.crouched).toBe(true); check(tile * 15 / 16);
      input = {...EMPTY_INPUT}; h.world.emit('beforeupdate');
      expect(player.state.crouched).toBe(false); check(tile * 30 / 16);
      player.setForm('small'); check(tile * 15 / 16);
    }
    player.setForm('big'); player.hurt(); check(tile * 15 / 16);
    expect(player.invulnerable).toBe(true);
    h.scene.events.emit('shutdown');
  });

  it('collides through the grown upper hull in Matter broadphase, where the small hull was clear', () => {
    const h = matterHarness(), player = createMatterPlayer(h.scene, 480, 200);
    // Add only after growth so canStand correctly sees clear space while resizing.
    const wall = Bodies.rectangle(503, 130, 8, 24, {isStatic: true, collisionFilter: {category: C.solid, mask: 0xffff, group: 0}});
    expect(Query.collides(player.body, [wall])).toHaveLength(0);
    player.setForm('big');
    h.world.add(wall);
    expect(Query.collides(player.body.parts[1], [wall])).toHaveLength(1);
    expect(Query.collides(player.body, [wall])).toHaveLength(1);
    const x = player.body.position.x;
    h.step();
    expect(player.body.position.x).toBeLessThan(x - 1);
    h.scene.events.emit('shutdown');
  });

  it.each([-512, 512])('anchors physical feet at negative coordinates with velocity %i and restored state', vy => {
    const h = matterHarness(), player = createMatterPlayer(h.scene, -480, -200);
    player.setState({...player.state, vx: 256, vy});
    h.step();
    const feet = player.body.parts[1]!.vertices.reduce((max, v) => Math.max(max, v.y), -Infinity);
    player.setForm('big'); expectCurrentCompound(player, 48, 120);
    expect(player.body.velocity.x).toBeGreaterThan(0);
    expect(Math.max(...player.body.parts[1]!.vertices.map(v => v.y))).toBeCloseTo(feet);
    const snapshot = player.state;
    player.hurt(); expectCurrentCompound(player, 48, 60);
    player.setState(snapshot); expectCurrentCompound(player, 48, 120);
    h.scene.events.emit('shutdown');
  });
});

describe('grown adapter rider on production seesaws', () => {
  it.each([32, 48, 64].flatMap(tile => [-1, 0, 1].map(sign => ({tile, sign}))))('lands, stands, jumps and re-lands on tilt $sign at tile $tile', ({tile, sign}) => {
    const h = matterHarness(); let input = {...EMPTY_INPUT};
    h.scene.matter.add.worldConstraint = ((body: MatterJS.BodyType, length: number, stiffness: number, options: object) => {
      const constraint = Constraint.create({bodyB: body, length, stiffness, ...options});
      Composite.add(h.engine.world, constraint); return constraint;
    }) as typeof h.scene.matter.add.worldConstraint;
    Object.assign(h.world, {removeConstraint: (c: unknown) => Composite.remove(h.engine.world, c)});
    const runtime = createElementRuntime(h.scene, {tile, input: () => input});
    const deck = runtime.add({id: 'deck', type: 'seesaw', x: 7.5, y: 6, props: {length: 6}}).bodies[0]!;
    Body.setAngle(deck, sign * SEESAW.maxAngle);
    const x = deck.position.x + sign * tile;
    const top = deck.position.y + (x - deck.position.x) * Math.tan(deck.angle) - tile * SEESAW.thickness / (2 * Math.cos(deck.angle));
    const gap = sign === 0 ? 6 : 70;
    const player = createMatterPlayer(h.scene, x, top - tile * 15 / 32 - gap, {tile, input: () => input, surface: runtime.surface, carry: runtime.carry});
    player.setForm('big'); runtime.attachPlayer(player);
    let resolvedContacts = 0;
    for (let frame = 0; frame < 360; frame++) {
      h.step();
      // An active main/deck solver pair proves the engine broadphase saw the hull.
      if (h.engine.pairs.list.some((pair: any) => pair.isActive && !pair.isSensor &&
        [pair.bodyA, pair.bodyB].includes(player.body.parts[1]) && [pair.bodyA, pair.bodyB].includes(deck))) resolvedContacts++;
    }
    const checkRest = (afterJump = false) => {
      const ys: number[] = [], xs: number[] = [];
      for (let frame = 0; frame < 120; frame++) {
        h.step();
        expectCurrentCompound(player, tile * 12 / 16, tile * 30 / 16, true);
        expect(Query.collides(player.sensors.foot, [deck])).toHaveLength(1);
        expect(Query.collides(player.body.parts[1], [deck])[0]?.depth ?? 0).toBeLessThan(tile / 100);
        expect(Math.abs(deck.angle)).toBeLessThanOrEqual(SEESAW.maxAngle + 1e-8);
        expect(Math.hypot(deck.position.x - 7.5 * tile, deck.position.y - 6 * tile)).toBeLessThan(0.001);
        xs.push(player.body.position.x); ys.push(player.body.position.y);
      }
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
      // A free center hinge can tilt under a re-landing impulse; carry may
      // then move the rider. This test does not add a restoring motor.
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(afterJump && sign === 0 ? tile / 8 : 0.5);
    };
    if (sign !== 0) expect(resolvedContacts).toBeGreaterThan(0);
    checkRest();
    const y = player.body.position.y;
    input = {...EMPTY_INPUT, jump: true}; h.step();
    expect(player.state.vy).toBeLessThan(0);
    expect(player.body.position.y).toBeLessThan(y - tile / 8);
    expect(Query.collides(player.sensors.foot, [deck])).toHaveLength(0);
    input = {...EMPTY_INPUT};
    for (let frame = 0; frame < 180; frame++) h.step();
    checkRest(true);
    h.scene.events.emit('shutdown');
  });
});
