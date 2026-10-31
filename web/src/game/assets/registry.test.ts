import { describe, expect, it } from 'vitest';
import { elementTexture, getAnimations, groundTexture, isPixelArt, pruneMissing, readManifest, themeLayers } from './registry';
import { fetchPackManifest, manifestUrl } from './pack';

describe('asset packs', () => {
    it('falls back to Kenney when a missing pack returns the Vite HTML page', async () => {
        const urls: string[] = [];
        const fetcher = (async (url: string) => {
            urls.push(url);
            return urls.length === 1 ? new Response('<html>missing</html>') : Response.json({ schema: 1, elements: {} });
        }) as typeof fetch;
        const result = await fetchPackManifest('mario', fetcher);
        expect(result.pack).toBe('kenney');
        expect(urls).toEqual([manifestUrl('mario'), manifestUrl('kenney')]);
    });

    it('loads additive metadata, parallax and animation timing without a Kenney character name', () => {
        const files = readManifest({ schema: 1, pixelArt: true, sourceTile: 16,
            elements: { coin: { path: 'coin.png', displaySize: [0.75, 0.75], anchor: [0.5, 1] } },
            characters: { hero: { image: 'hero.png', atlas: 'hero.json', animations: { idle: { frames: ['stand'], frameRate: 3 } } } },
            themes: { grass: { parallax: [{ file: 'sky.png', scrollFactor: 0.1 }, { file: 'hills.png', scrollFactor: 0.4, y: 16 }] } },
        }, ['coin', 'player'], '/packs/mario/');
        expect(files).toContainEqual({ kind: 'image', key: 'coin', url: '/packs/mario/coin.png' });
        expect(elementTexture('coin')).toMatchObject({ displaySize: { w: 0.75, h: 0.75 }, anchor: { x: 0.5, y: 1 } });
        expect(elementTexture('player')).toMatchObject({ key: 'characters-hero', frame: 'stand' });
        expect(getAnimations()[0].frameRate).toBe(3);
        expect(isPixelArt()).toBe(true);
        expect(themeLayers('grass').map((l) => l.scrollFactor)).toEqual([0.1, 0.4]);
        pruneMissing((key) => key !== 'parallax:grass:1');
        expect(themeLayers('grass')).toHaveLength(1);
    });

    it('selects top corners and interior fill from neighbours, with a ground fallback', () => {
        readManifest({ elements: Object.fromEntries(['ground', 'top_left', 'top_right', 'fill'].map((name) => [`snow_${name}`, { path: `${name}.png` }])), themes: { snow: {} } }, ['ground']);
        const grid = new Uint8Array([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
        expect(groundTexture('snow', grid, 3, 4, 0, 1).key).toBe('snow_top_left');
        expect(groundTexture('snow', grid, 3, 4, 2, 1).key).toBe('snow_top_right');
        expect(groundTexture('snow', grid, 3, 4, 1, 2).key).toBe('snow_fill');
        expect(groundTexture('snow', grid, 3, 4, 1, 1).key).toBe('snow_ground');
    });
});
