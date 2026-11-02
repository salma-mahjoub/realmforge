import { describe, expect, it } from 'vitest';
import { PlayerCameraTarget } from './PlayerCameraTarget';

// Coordinates are physical body x / foot sensor y, never animation bounds.
describe('platformer camera target', () => {
    it('holds the floor baseline through an ordinary running jump and landing', () => {
        const target = new PlayerCameraTarget(100, 1000);
        for (const [feet, velocity] of [[980, -25], [900, -20], [800, -14], [700, -6], [680, 0], [800, 12], [900, 16], [1000, 16]]) {
            target.update(200.25, feet, false, 720, velocity);
            expect(target.y).toBe(1000);
        }
        target.update(200.25, 1000, true, 720);
        expect(target.x).toBe(200.25);
        expect(target.y).toBe(1000);
    });
    it('escapes the jump band for sustained ascent and descent in tall levels', () => {
        const target = new PlayerCameraTarget(100, 1000);
        target.update(200, 200, false, 720);
        expect(target.y).toBeLessThan(650);
        expect(target.y).toBeGreaterThan(200);
        target.update(200, 1800, false, 720);
        expect(target.y).toBeGreaterThan(1600);
        expect(target.y).toBeLessThan(1800);
    });
    it('tracks grounded slopes and elevated landings using the new floor baseline', () => {
        const target = new PlayerCameraTarget(100, 1000);
        for (const feet of [995, 990, 950, 880]) {
            target.update(200, feet, true, 720);
            expect(target.y).toBe(feet);
        }
        target.update(250, 600, false, 720);
        expect(target.y).toBe(880);
        target.update(250, 700, true, 720);
        expect(target.y).toBe(700);
    });
    it('starts vertical tracking earlier for fast springs and long falls', () => {
        const target = new PlayerCameraTarget(100, 1000);
        target.update(200, 800, false, 720, -36);
        expect(target.y).toBeLessThan(1000);
        target.update(200, 1500, false, 720, 16);
        expect(target.y).toBeGreaterThan(1470);
    });
    it('shrinks the escape band in short viewports to keep a jumping player visible', () => {
        const target = new PlayerCameraTarget(100, 1000);
        target.update(200, 750, false, 320);
        expect(target.y).toBeLessThan(950);
        target.update(200, 1000, false, 320);
        expect(target.y).toBeGreaterThan(950);
    });
});
