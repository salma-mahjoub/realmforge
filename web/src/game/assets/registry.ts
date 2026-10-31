/**
 * Texture registry: maps level element types to Phaser texture keys.
 *
 * Real art comes from /assets/manifest.json (schema 1, produced by asset-pipeline):
 *   elements[type]   = { texture, path, width, height, svg, aliasOf?, atlas?, image?, frame? }
 *                      theme variants are flat keys like `snow_ground`, `castle_one_way`
 *   characters[name] = { texture, image, atlas, animations{ name: { frames[], frameRate, repeat } } }
 *   enemies[type]    = same shape as characters
 *   themes[theme]    = { texture, path (tileset), tiles{...}, background{ texture, path } }
 *   sfx/music[key]   = { path, loop }
 * Anything missing gets a generated placeholder (placeholders.ts), so the game always boots.
 */
import type { ElementType, Theme } from '../level/types';

export interface TextureRef {
    key: string;
    frame?: string | number;
    displaySize?: { w: number; h: number };
    anchor?: { x: number; y: number };
}

export type ManifestFile =
    | { kind: 'image'; key: string; url: string }
    | { kind: 'atlas'; key: string; textureURL: string; atlasURL: string }
    | { kind: 'sheet'; key: string; url: string; frameWidth: number; frameHeight: number; margin?: number; spacing?: number }
    | { kind: 'audio'; key: string; urls: string[] };

export interface AnimDef {
    key: string;
    texture: string;
    frames: string[];
    frameRate: number;
    repeat: number;
}

export interface ImageEntry {
    texture?: string;
    path?: string;
    image?: string;
    atlas?: string;
    frame?: string | number;
    displaySize?: { w?: number; h?: number; width?: number; height?: number } | [number, number];
    anchor?: { x: number; y: number } | [number, number];
    animations?: Record<string, { frames?: string[]; frameRate?: number; repeat?: number }>;
}

interface ManifestV1 {
    schema?: number;
    baseUrl?: string;
    pixelArt?: boolean;
    sourceTile?: number;
    elements?: Record<string, ImageEntry>;
    characters?: Record<string, ImageEntry>;
    enemies?: Record<string, ImageEntry>;
    themes?: Record<string, ImageEntry & { background?: ImageEntry; tileWidth?: number; tileHeight?: number; margin?: number; spacing?: number; tiles?: Record<string, number | ImageEntry>; parallax?: { file: string; scrollFactor: number; y?: number }[] }>;
    sfx?: Record<string, { path?: string }>;
}

/** game-core element types → extra names used by the asset pack (first match wins; theme variants are `${theme}_${name}`). */
const ALIASES: Partial<Record<ElementType | 'player', string[]>> = {
    question_block: ['question'],
    chain_bridge: ['chain_link'],
    switch_block: ['switch-block'],
};

/** Preferred playable character for the local player (violet, like the mockups). */
const PLAYER_CHARACTERS = ['small', 'mario_small', 'mario', 'purple', 'green', 'pink', 'beige'];

let base = '/assets/';

/** Resolve a manifest path relative to the manifest's baseUrl (default /assets/). */
export function assetUrl(p: string): string {
    if (/^(https?:)?\/\//.test(p) || p.startsWith('/') || p.startsWith('data:')) return p;
    return `${base}${p.replace(/^\.\//, '')}`;
}

const elementTextures = new Map<string, TextureRef>();
const themedTextures = new Map<string, TextureRef>(); // `${theme}:${type}`
export interface BackgroundLayer { key: string; scrollFactor: number; y?: number }
const backgrounds = new Map<string, BackgroundLayer[]>();
const variants = new Map<string, TextureRef>();
let pixelArt = false;
let sourceTile = 64;
export const isPixelArt = () => pixelArt;
export const packSourceTile = () => sourceTile;
const animations: AnimDef[] = [];
const sfx = new Set<string>();

export function placeholderKey(type: string): string {
    return `ph:${type}`;
}

/** Texture for an element; prefers a theme-specific variant (e.g. `snow_ground`). */
export function elementTexture(type: string, theme?: Theme | string): TextureRef {
    return (theme && themedTextures.get(`${theme}:${type}`)) || elementTextures.get(type) || { key: placeholderKey(type) };
}

export function themeBackground(theme: string): string | undefined {
    return backgrounds.get(theme)?.[0]?.key;
}

export function themeLayers(theme: string): readonly BackgroundLayer[] {
    return backgrounds.get(theme) ?? [];
}

/** Pick exposed top edges and interior fill without changing the collision grid. */
export function groundTexture(theme: string, grid: readonly number[] | Uint8Array, w: number, h: number, x: number, y: number): TextureRef {
    const ground = (cx: number, cy: number) => cy >= h || (cx >= 0 && cx < w && cy >= 0 && grid[cy * w + cx] === 1);
    const top = !ground(x, y - 1), left = !ground(x - 1, y), right = !ground(x + 1, y);
    const names = top ? [left ? 'top_left' : right ? 'top_right' : 'top', 'ground']
        : [left ? 'left' : right ? 'right' : !ground(x, y + 1) ? 'bottom' : 'fill', 'inner', 'fill'];
    for (const name of names) {
        const ref = variants.get(`${theme}:${name}`);
        if (ref) return ref;
    }
    return elementTexture('ground', theme);
}

export function getAnimations(): readonly AnimDef[] {
    return animations;
}

export function hasSfx(key: string): boolean {
    return sfx.has(key);
}

/** Drop mappings whose texture failed to load so lookups fall back to placeholders. */
export function pruneMissing(exists: (key: string) => boolean): void {
    for (const map of [elementTextures, themedTextures, variants]) {
        for (const [k, ref] of map) if (!exists(ref.key)) map.delete(k);
    }
    for (const [k, layers] of backgrounds) backgrounds.set(k, layers.filter((layer) => exists(layer.key)));
}

/**
 * Build the load list + element texture map from the manifest. Pure (no Phaser).
 * Unknown/unsupported sections are ignored rather than guessed at.
 */
export function readManifest(manifest: unknown, knownTypes: readonly string[], manifestDirectory = "/assets/"): ManifestFile[] {
    const m = (manifest ?? {}) as ManifestV1;
    base = typeof m.baseUrl === 'string' ? (m.baseUrl.endsWith('/') ? m.baseUrl : `${m.baseUrl}/`) : manifestDirectory;
    pixelArt = m.pixelArt === true;
    sourceTile = m.sourceTile ?? 64;
    variants.clear();
    elementTextures.clear();
    themedTextures.clear();
    backgrounds.clear();
    animations.length = 0;
    sfx.clear();

    const files: ManifestFile[] = [];
    const loaded = new Set<string>();

    /** Queue an entry's texture; returns the ref to use, or null if the entry is unusable. */
    const queue = (e: ImageEntry | undefined, fallbackKey: string): TextureRef | null => {
        if (!e) return null;
        const key = e.texture || fallbackKey;
        const img = e.image || e.path;
        const d = e.displaySize;
        const displaySize = d ? (Array.isArray(d) ? { w: d[0], h: d[1] } : { w: d.w ?? d.width ?? 1, h: d.h ?? d.height ?? 1 }) : undefined;
        const anchor = Array.isArray(e.anchor) ? { x: e.anchor[0], y: e.anchor[1] } : e.anchor;
        const metadata = { displaySize, anchor };
        if (e.atlas && img) {
            if (!loaded.has(key)) {
                loaded.add(key);
                files.push({ kind: 'atlas', key, textureURL: assetUrl(img), atlasURL: assetUrl(e.atlas) });
                for (const [name, a] of Object.entries(e.animations ?? {})) {
                    if (a.frames?.length) animations.push({ key: `${key}:${name}`, texture: key, frames: a.frames, frameRate: a.frameRate ?? 8, repeat: a.repeat ?? -1 });
                }
            }
            return { key, frame: e.frame ?? e.animations?.idle?.frames?.[0] ?? Object.values(e.animations ?? {})[0]?.frames?.[0], ...metadata };
        }
        if (img && /\.(png|jpe?g|webp)$/i.test(img)) {
            if (!loaded.has(key)) {
                loaded.add(key);
                files.push({ kind: 'image', key, url: assetUrl(img) });
            }
            return { key, ...metadata };
        }
        return null;
    };

    const els = m.elements ?? {};
    const themes = Object.keys(m.themes ?? {});
    for (const type of knownTypes) {
        const names = [type, ...(ALIASES[type as ElementType] ?? [])];
        for (const n of names) {
            const ref = queue(els[n], n);
            if (ref) {
                elementTextures.set(type, ref);
                break;
            }
        }
        for (const theme of themes) {
            for (const n of names) {
                const ref = queue(els[`${theme}_${n}`], `${theme}_${n}`);
                if (ref) {
                    themedTextures.set(`${theme}:${type}`, ref);
                    break;
                }
            }
        }
    }

    // enemies with animation atlases override the flat element image
    for (const [type, e] of Object.entries(m.enemies ?? {})) {
        const ref = queue(e, `enemies-${type}`);
        if (ref && knownTypes.includes(type)) elementTextures.set(type, ref);
    }

    // characters: queue all (remote racers use other colours), pick the local player's one
    const chars = m.characters ?? {};
    for (const [name, e] of Object.entries(chars)) queue(e, `characters-${name}`);
    for (const name of [...PLAYER_CHARACTERS, ...Object.keys(chars)]) {
        const ref = queue(chars[name], `characters-${name}`);
        if (ref) {
            elementTextures.set('player', ref);
            break;
        }
    }

    // Queue auxiliary frames as well (spring_extended, coin_side, terrain edges).
    for (const [name, entry] of Object.entries(els)) {
        const ref = queue(entry, name);
        if (ref) {
            if (!elementTextures.has(name)) elementTextures.set(name, ref);
            for (const theme of themes) if (name.startsWith(`${theme}_`)) variants.set(`${theme}:${name.slice(theme.length + 1)}`, ref);
        }
    }
    for (const [theme, t] of Object.entries(m.themes ?? {})) {
        // Theme sheets provide the same variants when there are no individual PNGs.
        if (t.path && t.tiles && t.tileWidth) {
            const key = t.texture ?? `tiles-${theme}`;
            files.push({ kind: 'sheet', key, url: assetUrl(t.path), frameWidth: t.tileWidth, frameHeight: t.tileHeight ?? t.tileWidth, margin: t.margin, spacing: t.spacing });
            for (const [name, frame] of Object.entries(t.tiles)) {
                const ref = typeof frame === 'number' ? { key, frame } : queue(frame, `${theme}_${name}`);
                if (ref) {
                    if (!variants.has(`${theme}:${name}`)) variants.set(`${theme}:${name}`, ref);
                    const type = name === 'question' ? 'question_block' : name;
                    if (knownTypes.includes(type) && !themedTextures.has(`${theme}:${type}`)) themedTextures.set(`${theme}:${type}`, ref);
                }
            }
        }
        const layers: BackgroundLayer[] = [];
        for (const [i, layer] of (t.parallax ?? []).entries()) {
            const ref = queue({ path: layer.file }, `parallax:${theme}:${i}`);
            if (ref) layers.push({ key: ref.key, scrollFactor: layer.scrollFactor, y: layer.y });
        }
        if (!layers.length) {
            const ref = queue(t.background ?? els[`background_${theme}`], `background_${theme}`);
            if (ref) layers.push({ key: ref.key, scrollFactor: 0.25 });
        }
        backgrounds.set(theme, layers);
    }

    for (const [key, s] of Object.entries(m.sfx ?? {})) {
        if (s.path) {
            sfx.add(`sfx:${key}`);
            files.push({ kind: 'audio', key: `sfx:${key}`, urls: [assetUrl(s.path)] });
        }
    }

    return files;
}
