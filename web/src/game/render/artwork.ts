import Phaser from 'phaser';
import { completeGroundVariants, elementTexture, isCharacterTexture, isPixelArt, mapTerrainTextures } from '../assets/registry';
import { ELEMENT_TYPES } from '@realmforge/game-core';
import { THEMES } from '../level/types';

const thumbnails = new Map<string, string>();
const characterMetrics = new Map<string, { standing: number; frames: Map<string, { height: number; canvasHeight: number; feetPadding: number }> }>();

/** Fixed atlas canvas keeps poses stable; only big crouching uses its shorter hull. */
export function characterDisplay(key: string, frame: string | number, hullHeight: number, crouched: boolean) {
    const metrics = characterMetrics.get(key), pose = metrics?.frames.get(String(frame));
    if (!metrics || !pose) return { height: hullHeight, feetOffset: 0 };
    const scale = hullHeight / (crouched ? pose.height : metrics.standing);
    return { height: pose.canvasHeight * scale, feetOffset: pose.feetPadding * scale };
}

export const spriteThumbnail = (type: string, theme = 'snow') => thumbnails.get(`${theme}:${type}`);

/** Remove transparent export padding, so displaySize measures artwork, not empty atlas cells. */
export function prepareArtwork(scene: Phaser.Scene) {
    thumbnails.clear();
    characterMetrics.clear();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    for (const key of scene.textures.getTextureKeys()) {
        const texture = scene.textures.get(key);
        texture.setFilter(isPixelArt() ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
        if (/^(background|parallax|tiles-|ph:)/.test(key)) continue;
        const character = isCharacterTexture(key);
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
                    if (character) {
                        const metrics = characterMetrics.get(key) ?? { standing: h, frames: new Map() };
                        metrics.frames.set(String(name), { height: h, canvasHeight: frame.cutHeight, feetPadding: frame.cutHeight - bottom - 1 });
                        characterMetrics.set(key, metrics);
                        continue;
                    }
                    frame.setSize(w, h, frame.cutX + left, frame.cutY + top);
                    frame.setTrim(w, h, 0, 0, w, h);
                }
            } catch { /* Remote images without CORS can still render without trimming. */ }
        }
    }
    completeGroundVariants((base, corners, id) => {
        const frame = scene.textures.getFrame(base.key, base.frame);
        if (!frame) return base;
        const copy = document.createElement('canvas');
        copy.width = frame.cutWidth; copy.height = frame.cutHeight;
        const c = copy.getContext('2d');
        if (!c) return base;
        c.drawImage(frame.source.image as CanvasImageSource, frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight, 0, 0, copy.width, copy.height);
        for (const corner of corners) {
            const f = scene.textures.getFrame(corner.ref.key, corner.ref.frame);
            if (!f) continue;
            const dx = corner.x * copy.width / 2, dy = corner.y * copy.height / 2;
            c.clearRect(dx, dy, copy.width / 2, copy.height / 2);
            c.drawImage(f.source.image as CanvasImageSource, f.cutX + corner.x * f.cutWidth / 2, f.cutY + corner.y * f.cutHeight / 2,
                f.cutWidth / 2, f.cutHeight / 2, dx, dy, copy.width / 2, copy.height / 2);
        }
        const key = `terrain:${id}`;
        return scene.textures.addCanvas(key, copy) ? { key } : base;
    });
    // Two extruded pixels outside each frame keep neighbouring atlas cells out of UV samples.
    const padded = new Map<string, { key: string; frame: string }>();
    mapTerrainTextures((ref) => {
        const id = `${ref.key}:${ref.frame ?? '__BASE'}`;
        const cached = padded.get(id);
        if (cached) return { ...ref, ...cached };
        const frame = scene.textures.getFrame(ref.key, ref.frame);
        if (!frame) return ref;
        const pad = 2, w = frame.cutWidth, h = frame.cutHeight;
        const copy = document.createElement('canvas');
        copy.width = w + pad * 2; copy.height = h + pad * 2;
        const c = copy.getContext('2d');
        if (!c) return ref;
        const src = frame.source.image as CanvasImageSource;
        const sx = frame.cutX, sy = frame.cutY;
        c.drawImage(src, sx, sy, w, h, pad, pad, w, h);
        c.drawImage(src, sx, sy, w, 1, pad, 0, w, pad);
        c.drawImage(src, sx, sy + h - 1, w, 1, pad, h + pad, w, pad);
        c.drawImage(src, sx, sy, 1, h, 0, pad, pad, h);
        c.drawImage(src, sx + w - 1, sy, 1, h, w + pad, pad, pad, h);
        for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) {
            c.drawImage(src, sx + x, sy + y, 1, 1, x ? w + pad : 0, y ? h + pad : 0, pad, pad);
        }
        const key = `padded:${id}`;
        const texture = scene.textures.addCanvas(key, copy);
        if (!texture) return ref;
        texture.add('tile', 0, pad, pad, w, h);
        texture.setFilter(isPixelArt() ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
        const replacement = { key, frame: 'tile' };
        padded.set(id, replacement);
        return { ...ref, ...replacement };
    });
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
