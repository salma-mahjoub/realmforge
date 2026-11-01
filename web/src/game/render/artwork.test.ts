import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { readManifest } from '../assets/registry';
import { prepareArtwork } from './artwork';
import manifest from '../../../public/packs/mario/manifest.json';

vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { NEAREST: 0, LINEAR: 1 } } } }));

// Exercise the preparation pass that used to trim the canvas before gameplay.
describe('source-native Goomba canvas', () => {
    it('preserves the shared 120×100 canvas for walk and flattened stomp', () => {
        readManifest(manifest, ['walker']);
        const frames = Object.fromEntries(['goomba_walk_00', 'goomba_stomp_13'].map(name => [name, {
            cutWidth: 120, cutHeight: 100, setSize: vi.fn(), setTrim: vi.fn(),
        }]));
        const texture = { setFilter: vi.fn(), frames, frameTotal: 3, get: (name: string) => frames[name] };
        const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8Array(120 * 100 * 4).fill(255) })) };
        vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx, toDataURL: () => '' }) });
        const scene = { textures: {
            getTextureKeys: () => ['mario-walker'], get: () => texture,
            exists: (key: string) => key === 'mario-walker', getFrame: (key: string) => key === 'mario-walker' ? frames.goomba_walk_00 : undefined,
        } } as unknown as Phaser.Scene;
        try {
            prepareArtwork(scene);
            for (const frame of Object.values(frames)) {
                expect(frame.setSize).not.toHaveBeenCalled(); expect(frame.setTrim).not.toHaveBeenCalled();
                expect(frame.cutWidth / frame.cutHeight).toBe(1.2);
            }
        } finally { vi.unstubAllGlobals(); }
    });
});
