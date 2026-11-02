import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { createBackground } from './background';

vi.mock('phaser', () => ({ default: { Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } }, Cameras: { Scene2D: { Events: { PRE_RENDER: 'prerender' } } } } }));
vi.mock('../assets/registry', () => ({ themeLayers: () => [{ key: 'sky', scrollFactor: 0.25, y: 12 }] }));

function harness() {
    const cam = Object.assign(new EventEmitter(), { width: 1382, height: 638, zoom: 0.984375, scrollX: 0, scrollY: 500, setRoundPixels: vi.fn() });
    const sprite = { x: 0, y: 0, width: 1, height: 1, tileScaleX: 1, tileScaleY: 1, tilePositionX: 0, tilePositionY: 0,
        setOrigin() { return this; }, setScrollFactor() { return this; }, setDepth() { return this; }, setAlpha() { return this; },
        setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
        setSize: vi.fn(function (this: { width: number; height: number }, w: number, h: number) { this.width = w; this.height = h; return this; }),
        setTileScale: vi.fn(function (this: { tileScaleX: number }, s: number) { this.tileScaleX = s; (this as unknown as { tileScaleY: number }).tileScaleY = s; return this; }),
    };
    const events = new EventEmitter();
    const scene = { cameras: { main: cam }, events, textures: { exists: () => true, get: () => ({ getSourceImage: () => ({ width: 800, height: 400 }) }) }, add: { tileSprite: () => sprite } };
    createBackground(scene as unknown as Phaser.Scene, 'grass');
    const render = () => { events.emit('postupdate'); cam.emit('prerender', cam); };
    return { cam, sprite, events, render };
}

describe('background render phase', () => {
    it('uses the scroll from this camera render, after camera follow/clamping', () => {
        const { cam, sprite, events } = harness();
        events.emit('postupdate');
        cam.scrollX = 100.5; // Camera.preRender follows AFTER scene POST_UPDATE.
        cam.emit('prerender', cam);
        expect(sprite.tilePositionX * sprite.tileScaleX - (cam.width - sprite.width) / 2).toBeCloseTo(25.125, 10);
    });
    it('covers fractional zoom with integral backing dimensions and does not resize while walking', () => {
        const { cam, sprite, render } = harness();
        render();
        expect(Number.isInteger(sprite.width) && Number.isInteger(sprite.height)).toBe(true);
        expect(sprite.width * cam.zoom).toBeGreaterThanOrEqual(cam.width);
        expect(sprite.height * cam.zoom).toBeGreaterThanOrEqual(cam.height);
        const sizes = sprite.setSize.mock.calls.length, scales = sprite.setTileScale.mock.calls.length;
        for (let i = 0; i < 30; i++) { cam.scrollX += 1.25; render(); }
        expect(sprite.setSize.mock.calls.length).toBe(sizes);
        expect(sprite.setTileScale.mock.calls.length).toBe(scales);
        cam.width = 900; cam.height = 500; cam.zoom = 0.625;
        render();
        expect(sprite.width * cam.zoom).toBeGreaterThanOrEqual(900);
        expect(sprite.height * cam.zoom).toBeGreaterThanOrEqual(500);
        // Visible top sample stays at the layer's authored -12 offset despite overscan/zoom.
        expect(sprite.tilePositionY * sprite.tileScaleX + (sprite.height - cam.height / cam.zoom) / 2).toBeCloseTo(-12);
        expect(sprite.tilePositionX * sprite.tileScaleX - (cam.width - sprite.width) / 2).toBeCloseTo(cam.scrollX * 0.25);
    });
    it('detaches its camera render listener when the scene shuts down', () => {
        const { cam, events } = harness();
        events.emit('shutdown');
        expect(cam.listenerCount('prerender')).toBe(0);
        expect(events.listenerCount('postupdate')).toBe(0);
    });
});
