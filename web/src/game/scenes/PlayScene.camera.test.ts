import { describe, expect, it, vi } from 'vitest';
import { MovementState } from '@realmforge/game-core';
import { PlayScene } from './PlayScene';

vi.mock('phaser', async () => ({ Events: { EventEmitter: (await import('node:events')).EventEmitter }, default: { Scene: class {}, Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } } }));

// Call the real presentation consumer; no Matter step/physics data is changed by rendering.
function presentation(sweep: number) {
    const sprite = { x: 0, y: 0, width: 48, height: 60, frame: { name: 'idle' }, anims: { timeScale: 1 },
        displayWidth: 0, displayHeight: 0,
        setPosition(x: number, y: number) { this.x = x; this.y = y; return this; }, setVisible() {}, setFlipX() {}, setOrigin() {},
        setDisplaySize(w: number, h: number) { this.displayWidth = w; this.displayHeight = h; },
    };
    const s = Object.assign(new PlayScene(), { playerSprite: sprite, playerTex: 'ph:player', player: {
        body: { position: { x: 100.25, y: 200 }, parts: [{}, { position: { x: 100.25, y: 200 }, bounds: { min: { y: 170 + Math.min(sweep, 0) }, max: { y: 230 + Math.max(sweep, 0) } } }] },
        sensors: { foot: { position: { y: 230 } }, head: { position: { y: 170 } } },
        state: { mode: MovementState.fall, vx: 0, vy: 0, facing: 1 },
    }, previousMode: MovementState.fall, anims: { exists: () => false } });
    (s as unknown as { syncSprite(): void }).syncSprite();
    return sprite;
}

describe('physical player presentation', () => {
    it('keeps the feet and height stable when Matter expands the collision bounds during a fall', () => {
        const still = presentation(0), falling = presentation(20);
        expect(falling.y).toBe(still.y);
        expect(falling.displayHeight).toBe(still.displayHeight);
    });
    it('preserves subpixel physical motion rather than rounding separately from the camera', () => {
        expect(presentation(0).x).toBe(100.25);
    });
});
