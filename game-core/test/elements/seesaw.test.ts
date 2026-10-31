import {createRequire} from 'node:module';
import {describe, expect, it} from 'vitest';
import type Phaser from 'phaser';
import {createMatterPlayer} from '../../src/adapters/phaserMatter.js';
import {createElementRuntime, ELEMENTS} from '../../src/elements/index.js';
import {SEESAW} from '../../src/elements/seesaw.js';
import {EMPTY_INPUT} from '../../src/input.js';
import {worldToFixed} from '../../src/constants.js';
import {matterHarness, Bodies, Body, Composite, Query} from '../matterHarness.js';

const require = createRequire(import.meta.url);
const Constraint = require('phaser/src/physics/matter-js/lib/constraint/Constraint.js');

function setup(tile = 64, props: Record<string, unknown> = {}, withPivot = false) {
    const h = matterHarness();
    const images: Array<Record<string, any>> = [];
    h.scene.add.image = ((x: number, y: number, texture: string) => {
        const image = {x, y, texture, rotation: 0, displayWidth: 0, displayHeight: 0, scaleX: 1, scaleY: 1, alpha: 1, destroyed: false,
            setDisplaySize(w: number, h: number) {this.displayWidth = w; this.displayHeight = h; return this;},
            setPosition(x: number, y: number) {this.x = x; this.y = y; return this;},
            setRotation(a: number) {this.rotation = a; return this;},
            setOrigin() {return this;}, setDepth() {return this;},
            setAlpha(alpha: number) {this.alpha = alpha; return this;}, destroy() {this.destroyed = true;},
        };
        images.push(image); return image;
    }) as unknown as Phaser.GameObjects.GameObjectFactory['image'];
    h.scene.matter.add.worldConstraint = ((body: MatterJS.BodyType, length: number, stiffness: number, options: object) => {
        const c = Constraint.create({bodyB: body, length, stiffness, ...options});
        Composite.add(h.engine.world, c); return c;
    }) as typeof h.scene.matter.add.worldConstraint;
    Object.assign(h.world, {removeConstraint: (c: unknown) => Composite.remove(h.engine.world, c)});
    let input = {...EMPTY_INPUT};
    const runtime = createElementRuntime(h.scene, {tile, textures: {seesaw: {texture: 'deck', displaySize: {w: 5, h: 0.5}}, ...(withPivot ? {seesaw_pivot: {texture: 'pivot', displaySize: {w: 0.75, h: 0.75}}} : {})}, input: () => input});
    const element = runtime.add({id: 'seesaw', type: 'seesaw', x: 6, y: 6, props: {length: 6, ...props}});
    const body = element.bodies[0]!;
    return {...h, tile, runtime, element, body, images, setInput(value: typeof input) {input = value;},
        rider(x = body.position.x, form: 'small' | 'big' = 'small', gap = Math.abs(body.angle) > 0 ? tile + 6 : 6) {
            // A short fall onto the actual slope, with the production controller and sensors.
            const deckY = body.position.y + (x - body.position.x) * Math.tan(body.angle) - tile * Number(element.def.props!.height) * SEESAW.thickness / (2 * Math.cos(body.angle));
            const player = createMatterPlayer(h.scene, x, deckY - tile * 15 / 32 - gap, {tile, input: () => input, surface: runtime.surface, carry: runtime.carry});
            player.setForm(form); runtime.attachPlayer(player); return player;
        },
    };
}

describe('seesaw deck and hinge', () => {
    it.each([32, 48, 64])('uses a visible 0.45-tile collision deck at tile %i, preserving center, weight and inertia', tile => {
        const h = setup(tile, {width: 1.5, height: 1.2, length: 5});
        const width = tile * 1.5 * 5, height = tile * 1.2;
        const legacy = Bodies.rectangle(0, 0, width, height * 0.25);
        expect(h.body.bounds.max.x - h.body.bounds.min.x).toBeCloseTo(width);
        expect(h.body.bounds.max.y - h.body.bounds.min.y).toBeCloseTo(height * 0.45);
        expect(h.body.mass).toBeCloseTo(legacy.mass, 10);
        expect(h.body.inertia).toBeCloseTo(legacy.inertia, 7);
        expect(h.body.isStatic).toBe(false); expect(h.body.isSensor).toBe(false);
        expect(h.element.constraints).toHaveLength(1);
        const hinge = h.element.constraints[0]!;
        expect(hinge.pointA).toEqual({x: 6 * tile, y: 6 * tile});
        expect(hinge.pointB).toEqual({x: 0, y: 0});
        expect(hinge.length).toBe(0); expect(hinge.stiffness).toBe(1);
        expect(h.images[0]).toMatchObject({x: 6 * tile, y: 6 * tile, displayWidth: width, displayHeight: height * 0.45});
        Body.setAngle(h.body, 0.2); h.element.update(1);
        expect(h.images[0]!.rotation).toBeCloseTo(h.body.angle);
        h.scene.events.emit('shutdown');
        expect(h.world.listenerCount('beforeupdate')).toBe(0);
        expect(h.world.listenerCount('afterupdate')).toBe(0);
        expect(Composite.allConstraints(h.engine.world)).toHaveLength(0);
    });

    it('leaves other quarter-height platform bodies unchanged', () => {
        const h = setup();
        for (const type of ['moving_platform', 'rotating_platform', 'one_way', 'conveyor_belt'] as const) {
            const element = ELEMENTS[type](h.scene, {id: type, type, x: 0, y: 0}, {tile: 64, linkResolver: () => undefined});
            expect(element.bodies[0]!.bounds.max.y - element.bodies[0]!.bounds.min.y).toBe(16);
        }
        h.scene.events.emit('shutdown');
    });

    it('keeps the optional visible pivot on the axle while the matching deck rotates, dims and cleans up both', () => {
        const h = setup(64, {}, true), deck = h.images[0]!, pivot = h.images[1]!;
        expect(deck.displayHeight).toBe(28.8);
        expect(pivot).toMatchObject({x: 384, y: 390.4, displayWidth: 48, displayHeight: 48, rotation: 0});
        expect(pivot.y).toBeLessThan(h.body.bounds.max.y); // overlapping joint, no floating gap
        Body.setAngle(h.body, SEESAW.maxAngle); h.element.update(1);
        expect(deck.rotation).toBe(SEESAW.maxAngle);
        expect(pivot).toMatchObject({x: 384, y: 390.4, rotation: 0});
        h.element.setEnabled(false); expect(deck.alpha).toBe(0.2); expect(pivot.alpha).toBe(0.2);
        h.element.setEnabled(true); expect(pivot.alpha).toBe(1);
        h.scene.events.emit('shutdown'); expect(deck.destroyed).toBe(true); expect(pivot.destroyed).toBe(true);
    });

    it.each([-1, 1])('stops outward rotation at the %i tilt limit and allows motion back inward', sign => {
        const h = setup();
        Body.setAngle(h.body, sign * (SEESAW.maxAngle - 0.001)); Body.setAngularVelocity(h.body, sign * 0.05);
        h.step();
        expect(h.body.angle).toBeCloseTo(sign * SEESAW.maxAngle);
        expect(h.body.angularVelocity).toBe(0);
        expect(h.body.position.x).toBeCloseTo(384, 5); expect(h.body.position.y).toBeCloseTo(384, 5);
        Body.setAngularVelocity(h.body, -sign * 0.01); h.step();
        expect(Math.abs(h.body.angle)).toBeLessThan(SEESAW.maxAngle);
        h.scene.events.emit('shutdown');
    });

    it('supports a centered rider at rest for 300 fixed steps', () => {
        const h = setup(), player = h.rider();
        const samples: number[] = []; let contacts = 0;
        for (let frame = 0; frame < 300; frame++) {
            h.step();
            if (frame >= 60) {samples.push(player.body.position.y); if (Query.collides(player.sensors.foot, [h.body]).length) contacts++;}
        }
        expect(contacts).toBeGreaterThanOrEqual(235);
        expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.5);
        expect(player.body.position.x).toBeCloseTo(384, 1);
        expect(Math.abs(h.body.angle)).toBeLessThan(0.002);
        expect(player.state.form).toBe('small'); expect(player.state.coyote).toBeGreaterThan(0);
        h.scene.events.emit('shutdown');
    });

    it('leaves feet-anchored growth and shrink state unchanged on the deck', () => {
        const h = setup(), player = h.rider();
        for (let frame = 0; frame < 60; frame++) h.step();
        const feet = player.body.parts[1]!.bounds.max.y;
        player.setForm('big');
        expect(player.form).toBe('big'); expect(player.body.parts[1]!.bounds.max.y).toBeCloseTo(feet);
        player.hurt();
        expect(player.form).toBe('small'); expect(player.invulnerable).toBe(true);
        expect(player.body.parts[1]!.bounds.max.y).toBeCloseTo(feet);
        h.scene.events.emit('shutdown');
    });

    it.each([32, 64].flatMap(tile => [-1, 1].map(sign => ({tile, sign}))))('keeps rider foot contacts on the $sign tilted deck at tile $tile', ({tile, sign}) => {
        const h = setup(tile); Body.setAngle(h.body, sign * SEESAW.maxAngle);
        const startX = h.body.position.x + sign * tile, player = h.rider(startX);
        let contacts = 0; const positions: Array<{x: number; y: number}> = [];
        for (let frame = 0; frame < 360; frame++) {
            h.step();
            if (frame >= 240) {
                positions.push({...player.body.position});
                if (Query.collides(player.sensors.foot, [h.body]).length) contacts++;
                const collision = Query.collides(player.body.parts[1], [h.body])[0];
                expect(collision?.depth ?? 0).toBeLessThan(tile / 100);
            }
            expect(Math.abs(h.body.angle)).toBeLessThanOrEqual(SEESAW.maxAngle + 1e-8);
        }
        expect(contacts).toBe(120);
        expect(Math.max(...positions.map(p => p.y)) - Math.min(...positions.map(p => p.y))).toBeLessThan(0.5);
        expect(Math.max(...positions.map(p => p.x)) - Math.min(...positions.map(p => p.x))).toBeLessThan(0.5);
        expect(Math.abs(player.body.position.x - startX)).toBeLessThan(tile * 0.5);
        expect(player.state.coyote).toBeGreaterThan(0);
        expect(player.form).toBe('small');
        h.setInput({...EMPTY_INPUT, jump: true}); h.step();
        expect(player.state.vy).toBeLessThan(0);
        h.scene.events.emit('shutdown');
    });

    it('tips under a real landing, keeps its axle fixed and carries the rider to the stop', () => {
        const h = setup(), player = h.rider(448, 'small', 70);
        let contacts = 0, movingFrames = 0, movingContacts = 0;
        for (let frame = 0; frame < 360; frame++) {
            h.step();
            if (h.body.angle > 0.05 && h.body.angle < SEESAW.maxAngle - 0.01) {
                movingFrames++;
                if (Query.collides(player.sensors.foot, [h.body]).length) movingContacts++;
            }
            if (frame >= 120 && Query.collides(player.sensors.foot, [h.body]).length) contacts++;
            expect(h.body.position.x).toBeCloseTo(384, 4); expect(h.body.position.y).toBeCloseTo(384, 4);
        }
        expect(h.body.angle).toBeCloseTo(SEESAW.maxAngle);
        expect(contacts).toBeGreaterThan(220);
        expect(movingFrames).toBeGreaterThan(10);
        expect(movingContacts / movingFrames).toBeGreaterThan(0.9);
        expect(player.state.x).toBe(worldToFixed(player.body.position.x));
        h.scene.events.emit('shutdown');
    });
});
