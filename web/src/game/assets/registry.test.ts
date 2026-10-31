import { describe, expect, it } from 'vitest';
import { elementTexture, getAnimations, completeGroundVariants, groundTexture, groundVariantNames, playerTexture, isPixelArt, pruneMissing, readManifest, themeLayers } from './registry';
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


describe('terrain topology and forms', () => {
    const names = ['single', 'pillar_bottom', 'single_left', 'bottom_left', 'pillar_top', 'pillar', 'top_left', 'left',
        'single_right', 'bottom_right', 'horizontal', 'bottom', 'top_right', 'right', 'top', 'fill'];

    it('selects every cardinal shape, including floating strips and one-tile pillars', () => {
        readManifest({ elements: Object.fromEntries(names.map((name) => [`grass_${name}`, { path: `${name}.png` }])), themes: { grass: {} } }, ['ground']);
        for (let mask = 0; mask < 16; mask++) {
            const grid = new Uint8Array([1, mask & 1 ? 1 : 0, 1, mask & 8 ? 1 : 0, 1, mask & 2 ? 1 : 0, 1, mask & 4 ? 1 : 0, 1]);
            expect(groundTexture('grass', grid, 3, 3, 1, 1).key).toBe(`grass_${names[mask]}`);
        }
    });

    it('normalizes irrelevant diagonals to the 47 connected blob shapes', () => {
        const variants = new Set<string>();
        for (let mask = 0; mask < 256; mask++) {
            const grid = new Uint8Array(9).fill(1);
            for (const [bit, cell] of [1, 5, 7, 3, 2, 8, 6, 0].entries()) grid[cell] = (mask >> bit) & 1;
            variants.add(groundVariantNames(grid, 3, 3, 1, 1)[0]);
        }
        expect(variants.size).toBe(47);
    });

    it('uses inner corners under a pit lip and updates diagonal topology', () => {
        readManifest({ elements: { snow_fill: { path: 'fill.png' }, snow_inner_top_right: { path: 'inner.png' } }, themes: { snow: {} } }, ['ground']);
        const grid = new Uint8Array(9).fill(1);
        grid[2] = 0;
        expect(groundTexture('snow', grid, 3, 3, 1, 1).key).toBe('snow_inner_top_right');
        grid[2] = 1;
        expect(groundTexture('snow', grid, 3, 3, 1, 1).key).toBe('snow_fill');
    });

    it('resolves both form atlases by character id and keeps a legacy-pack fallback', () => {
        readManifest({ characters: { mario: { path: 'big.png' }, mario_small: { path: 'small.png' } } }, ['player']);
        expect(playerTexture('big').key).toBe('characters-mario');
        expect(playerTexture('small').key).toBe('characters-mario_small');
        readManifest({ characters: { purple: { path: 'purple.png' } } }, ['player']);
        expect(playerTexture('big')).toEqual(playerTexture('small'));
    });
});


it('composes every concave blob from corner quarters without losing exposed cardinal edges', () => {
    const names = ['ground', 'top', 'top_left', 'top_right', 'fill', 'left', 'right', 'bottom', 'bottom_left', 'bottom_right',
        'pillar_top', 'pillar', 'pillar_bottom', 'single', 'horizontal', 'single_left', 'single_right',
        'inner_top_left', 'inner_top_right', 'inner_bottom_left', 'inner_bottom_right'];
    readManifest({ elements: Object.fromEntries(names.map((name) => [`snow_${name}`, { path: `${name}.png` }])), themes: { snow: {} } }, ['ground']);
    const compositions = new Map<string, { base: string; corners: number }>();
    completeGroundVariants((base, corners, id) => {
        compositions.set(id, { base: base.key, corners: corners.length });
        return { key: id };
    });
    expect(compositions.size).toBe(31);
    expect(compositions.get('snow:mask_15')).toEqual({ base: 'snow_fill', corners: 4 });
    expect(compositions.get('snow:mask_7')).toEqual({ base: 'snow_left', corners: 2 });
    const grid = new Uint8Array([0, 1, 0, 1, 1, 1, 0, 1, 0]);
    expect(groundTexture('snow', grid, 3, 3, 1, 1).key).toBe('snow:mask_15');
});
