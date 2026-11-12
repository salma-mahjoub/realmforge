import { describe, expect, it, vi } from 'vitest';
import type Phaser from 'phaser';
import { readManifest } from '../assets/registry';
import { prepareArtwork } from './artwork';

vi.mock('phaser', () => ({ default: { Textures: { FilterMode: { NEAREST: 0, LINEAR: 1 } } } }));

// A walker anchored at its feet keeps the shared canvas of its walk and stomp frames: trimming
// each pose would destroy its scale, aspect and foot alignment.
describe('feet-anchored walker canvas', () => {
    it('preserves the shared 120×100 canvas for walk and flattened stomp', () => {
        readManifest({ schema: 1, elements: { walker: { image: 'walker.png', atlas: 'walker.json', frames: ['walk_00', 'stomp_13'], anchor: [0.5, 1] } } }, ['walker']);
        const frames = Object.fromEntries(['walk_00', 'stomp_13'].map(name => [name, {
            cutWidth: 120, cutHeight: 100, setSize: vi.fn(), setTrim: vi.fn(),
        }]));
        const texture = { setFilter: vi.fn(), frames, frameTotal: 3, get: (name: string) => frames[name] };
        const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data: new Uint8Array(120 * 100 * 4).fill(255) })) };
        vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx, toDataURL: () => '' }) });
        const scene = { textures: {
            getTextureKeys: () => ['walker'], get: () => texture,
            exists: (key: string) => key === 'walker', getFrame: (key: string) => key === 'walker' ? frames.walk_00 : undefined,
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
