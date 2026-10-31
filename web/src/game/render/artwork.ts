import Phaser from 'phaser';
import { elementTexture, isPixelArt } from '../assets/registry';
import { ELEMENT_TYPES } from '@realmforge/game-core';
import { THEMES } from '../level/types';

const thumbnails = new Map<string, string>();
export const spriteThumbnail = (type: string, theme = 'snow') => thumbnails.get(`${theme}:${type}`);

/** Remove transparent export padding, so displaySize measures artwork, not empty atlas cells. */
export function prepareArtwork(scene: Phaser.Scene) {
    thumbnails.clear();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    for (const key of scene.textures.getTextureKeys()) {
        const texture = scene.textures.get(key);
        texture.setFilter(isPixelArt() ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
        if (/^(background|parallax|tiles-|ph:)/.test(key)) continue;
        // Terrain keeps its full tile box for seamless joins.
        if (/(ground|fill|left|right|bottom|brick|question|ice|slime|one_way|semi_solid)/.test(key)) continue;
        for (const name of Object.keys(texture.frames)) {
            if (name === '__BASE' && texture.frameTotal > 1) continue;
            const frame = texture.get(name);
            if (!isPixelArt() && ['seesaw', 'moving_platform', 'elevator', 'rotating_platform'].includes(key) && frame.cutWidth === 64 && frame.cutHeight === 64) {
                frame.setSize(60, 16, frame.cutX + 2, frame.cutY + 20);
                continue;
            }
            canvas.width = frame.cutWidth;
            canvas.height = frame.cutHeight;
            try {
                ctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, canvas.width, canvas.height);
                const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
                for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                    if (pixels[(y * canvas.width + x) * 4 + 3] < 16) continue;
                    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
                }
                if (right >= left && bottom >= top) {
                    const w = right - left + 1, h = bottom - top + 1;
                    frame.setSize(w, h, frame.cutX + left, frame.cutY + top);
                    frame.setTrim(w, h, 0, 0, w, h);
                }
            } catch { /* Remote images without CORS can still render without trimming. */ }
        }
    }
    for (const theme of THEMES) for (const type of [...ELEMENT_TYPES, 'player'] as const) {
        const ref = elementTexture(type, theme);
        if (!scene.textures.exists(ref.key)) continue;
        const frame = scene.textures.getFrame(ref.key, ref.frame);
        if (!frame) continue;
        canvas.width = frame.cutWidth; canvas.height = frame.cutHeight;
        try {
            ctx.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, canvas.width, canvas.height);
            thumbnails.set(`${theme}:${type}`, canvas.toDataURL());
        } catch { /* Fall back to the palette's labelled swatch. */ }
    }
}
