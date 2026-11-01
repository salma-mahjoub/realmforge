import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type Phaser from 'phaser';
import { createElementVisual, positionElementVisual, stompVisuals } from '../../src/elements/display.js';

function harness(animated = true) {
    const sprites: ReturnType<typeof sprite>[] = [];
    function sprite(x: number, y: number, texture: string, frame: string) {
        return Object.assign(new EventEmitter(), {
            x, y, width: 120, height: 100, displayWidth: 120, displayHeight: 100,
            scaleX: 1, scaleY: 1, originX: 0.5, originY: 0.5, depth: 2, flipX: false,
            texture: { key: texture }, frame: { name: frame }, active: true,
            setDisplaySize(w: number, h: number) { this.displayWidth = w; this.displayHeight = h; this.scaleX = w / this.width; this.scaleY = h / this.height; return this; },
            setOrigin(x: number, y: number) { this.originX = x; this.originY = y; return this; },
            setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
            setRotation() { return this; }, setData() { return this; },
            setDepth(d: number) { this.depth = d; return this; },
            setFlipX(f: boolean) { this.flipX = f; return this; },
            play: vi.fn(), destroy() { this.active = false; this.emit('destroy'); },
        });
    }
    const timer = { remove: vi.fn() };
    const duration = 14000 / 24;
    const animations = { frames: Array(14), duration };
    const scene = {
        add: { sprite: (x: number, y: number, key: string, frame: string) => { const v = sprite(x, y, key, frame); sprites.push(v); return v; } },
        anims: { exists: () => animated, get: () => animated ? animations : undefined },
        tweens: { add: vi.fn() }, time: { delayedCall: vi.fn(() => timer) },
    };
    return { scene: scene as unknown as Phaser.Scene, host: scene, sprites, timer, duration };
}

describe('enemy presentation (no physics changes)', () => {
    it('keeps native 120:100 proportions and bottom-centre feet through walk frames and motion', () => {
        const h = harness();
        const v = createElementVisual(h.scene, 'walker', { texture: 'mario-walker', frame: 'goomba_walk_00', displaySize: { w: 1.2, h: 1 }, anchor: { x: 0.5, y: 1 } }, 100, 200, 64, 64, 64);
        for (let i = 0; i < 16; i++) {
            v.emit('animationupdate'); positionElementVisual(v, 100 + i, 200, 0);
            expect(v.scaleX).toBeCloseTo(0.64); expect(v.scaleY).toBeCloseTo(v.scaleX);
            expect(v.originX).toBe(0.5); expect(v.originY).toBe(1); expect(v.y).toBe(232);
        }
    });
    it('plays the entire flattened stomp once, with unchanged scale, feet and facing', () => {
        const h = harness();
        const v = createElementVisual(h.scene, 'walker', { texture: 'mario-walker', displaySize: { w: 1.2, h: 1 }, anchor: { x: 0.5, y: 1 } }, 100, 200, 64, 64, 64);
        v.setFlipX(true); stompVisuals(h.scene, [v]); const ghost = h.sprites[1]!;
        expect(ghost.scaleX).toBeCloseTo(0.64); expect(ghost.scaleY).toBeCloseTo(0.64);
        expect(ghost.y).toBe(232); expect(ghost.flipX).toBe(true);
        expect(ghost.play).toHaveBeenCalledWith({ key: 'mario-walker:stomp', repeat: 0 });
        expect(h.host.tweens.add).not.toHaveBeenCalled();
        expect(h.host.time.delayedCall.mock.calls[0]?.[0]).toBeGreaterThan(h.duration);
        ghost.emit('animationcomplete-other'); expect(ghost.active).toBe(true);
        ghost.emit('animationcomplete-mario-walker:stomp'); expect(ghost.active).toBe(false);
        expect(h.timer.remove).toHaveBeenCalledWith(false);
    });
    it('cleans up if a timed animation never completes', () => {
        const h = harness(); const v = createElementVisual(h.scene, 'walker', { texture: 'mario-walker' }, 0, 0, 64, 64, 64);
        stompVisuals(h.scene, [v]);
        const callback = h.host.time.delayedCall.mock.calls[0]?.[1] as unknown as () => void;
        callback(); expect(h.sprites[1]!.active).toBe(false);
    });
    it('retains the static Kenney fallback without requiring a stomp animation', () => {
        const h = harness(false); const v = createElementVisual(h.scene, 'walker', { texture: 'kenney-walker' }, 0, 0, 64, 64, 64);
        stompVisuals(h.scene, [v]);
        expect(h.sprites[1]!.play).not.toHaveBeenCalled();
        expect(h.host.tweens.add).toHaveBeenCalledWith(expect.objectContaining({ duration: 220, alpha: 0 }));
        expect(h.host.time.delayedCall).not.toHaveBeenCalled();
    });
});
