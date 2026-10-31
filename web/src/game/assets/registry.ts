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
    /** Independent static particle variants; never a temporal animation. */
    variants?: string[];
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
    variants?: string[];
    frames?: string[];
    frameRate?: number;
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
    items?: Record<string, ImageEntry>;
    fx?: Record<string, ImageEntry>;
    themes?: Record<string, ImageEntry & { background?: ImageEntry; tileWidth?: number; tileHeight?: number; margin?: number; spacing?: number; tiles?: Record<string, number | ImageEntry>; parallax?: { file: string; scrollFactor: number; y?: number }[] }>;
    sfx?: Record<string, { path?: string }>;
}

/** game-core element types → extra names used by the asset pack (first match wins; theme variants are `${theme}_${name}`). */
const ALIASES: Partial<Record<ElementType | 'player', string[]>> = {
    question_block: ['question'],
    chain_bridge: ['chain_link'],
    switch_block: ['switch-block'],
};

/** Character id; form selection happens independently of the pack's preferred colour. */
const PLAYER_CHARACTERS = ['mario', 'purple', 'green', 'pink', 'beige'];

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
const characters = new Map<string, TextureRef>();
const effects = new Map<string, TextureRef>();
/** Missing keys deliberately return undefined: the renderer supplies pooled procedural particles. */
export const effectTexture = (name: string): TextureRef | undefined => effects.get(name);
let playerCharacter = '';
export const isCharacterTexture = (key: string) => [...characters.values()].some((ref) => ref.key === key);

/** Form atlases share an id; packs without small art keep their existing character. */
export function playerTexture(form: 'small' | 'big'): TextureRef {
    return characters.get(form === 'small' ? `${playerCharacter}_small` : playerCharacter)
        ?? characters.get(playerCharacter) ?? elementTexture('player');
}

/** Replace terrain UVs with padded copies without changing the source pack. */
export function mapTerrainTextures(map: (ref: TextureRef) => TextureRef): void {
    for (const [name, ref] of variants) if (/^(ground|fill|top|bottom|left|right|inner|pillar|single|horizontal|mask|blob)(_|$)/.test(name.split(':')[1])) variants.set(name, map(ref));
    for (const refs of [elementTextures, themedTextures]) {
        for (const [name, ref] of refs) if (/(^|:)ground$/.test(name)) refs.set(name, map(ref));
    }
}
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

/** Cardinal mask first, diagonals only at connected corners (47-tile blob topology). */
export function groundVariantNames(grid: readonly number[] | Uint8Array, w: number, h: number, x: number, y: number): string[] {
    // The bottom of a level continues underground. Side boundaries remain exposed.
    const ground = (cx: number, cy: number) => cx >= 0 && cx < w && (cy >= h || (cy >= 0 && grid[cy * w + cx] === 1));
    const n = ground(x, y - 1), e = ground(x + 1, y), s = ground(x, y + 1), west = ground(x - 1, y);
    const mask = (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (west ? 8 : 0);
    const cardinal = ['single', 'pillar_bottom', 'single_left', 'bottom_left', 'pillar_top', 'pillar', 'top_left', 'left',
        'single_right', 'bottom_right', 'horizontal', 'bottom', 'top_right', 'right', 'top', 'fill'][mask];
    const corners: string[] = [];
    if (n && west && !ground(x - 1, y - 1)) corners.push('top_left');
    if (n && e && !ground(x + 1, y - 1)) corners.push('top_right');
    if (s && west && !ground(x - 1, y + 1)) corners.push('bottom_left');
    if (s && e && !ground(x + 1, y + 1)) corners.push('bottom_right');
    const blob = mask | (n && e && ground(x + 1, y - 1) ? 16 : 0) | (e && s && ground(x + 1, y + 1) ? 32 : 0)
        | (s && west && ground(x - 1, y + 1) ? 64 : 0) | (west && n && ground(x - 1, y - 1) ? 128 : 0);
    return [`mask_${blob}`, `blob_${blob}`, ...(corners.length ? [`${cardinal}_inner_${corners.join('_')}`, `inner_${corners.join('_')}`, ...corners.map((c) => `inner_${c}`)] : []),
        cardinal, ...(cardinal.startsWith('pillar') ? ['pillar', !n ? 'top' : !s ? 'bottom' : 'fill'] : []),
        ...(!n ? [!west ? 'top_left' : !e ? 'top_right' : 'top', 'ground'] : [!west ? 'left' : !e ? 'right' : !s ? 'bottom' : 'fill', 'inner', 'fill'])];
}

/** Compose concave quarters over the cardinal shape when a pack has corner art but no full blob atlas. */
export function completeGroundVariants(compose: (base: TextureRef, corners: { ref: TextureRef; x: number; y: number }[], id: string) => TextureRef): void {
    for (const theme of backgrounds.keys()) for (let mask = 0; mask < 256; mask++) {
        const grid = new Uint8Array(9).fill(1);
        for (const [bit, cell] of [1, 5, 7, 3, 2, 8, 6, 0].entries()) grid[cell] = (mask >> bit) & 1;
        const names = groundVariantNames(grid, 3, 3, 1, 1), id = `${theme}:${names[0]}`;
        if (variants.has(id)) continue;
        const cornerNames = [...new Set(names.filter((name) => /^inner_(top|bottom)_(left|right)$/.test(name)))];
        if (!cornerNames.length) continue;
        const corners = cornerNames.map((name) => ({ ref: variants.get(`${theme}:${name}`), x: name.endsWith('right') ? 1 : 0, y: name.startsWith('inner_bottom') ? 1 : 0 }));
        if (!corners.every((corner) => corner.ref)) continue;
        // Fully connected diagonals select the exposed cardinal edges without any inner-corner preference.
        for (const cell of [0, 2, 6, 8]) grid[cell] = 1;
        const base = groundTexture(theme, grid, 3, 3, 1, 1);
        variants.set(id, compose(base, corners as { ref: TextureRef; x: number; y: number }[], id));
    }
}

export function groundTexture(theme: string, grid: readonly number[] | Uint8Array, w: number, h: number, x: number, y: number): TextureRef {
    for (const name of groundVariantNames(grid, w, h, x, y)) {
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
    for (const map of [elementTextures, themedTextures, variants, characters, effects]) {
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
    characters.clear();
    effects.clear();
    playerCharacter = '';
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

    const els = { ...m.items, ...m.elements };
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
    for (const [name, e] of Object.entries(chars)) {
        const ref = queue(e, `characters-${name}`);
        if (ref) characters.set(name, ref);
    }
    for (const name of [...PLAYER_CHARACTERS, ...Object.keys(chars)]) {
        const ref = queue(chars[name], `characters-${name}`);
        if (ref) {
            playerCharacter = name.endsWith('_small') ? name.slice(0, -6) : name;
            elementTextures.set('player', characters.get(`${playerCharacter}_small`) ?? ref);
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

    for (const [name, entry] of Object.entries(m.fx ?? {})) {
        const ref = queue({ ...entry, animations: entry.animations ?? (entry.frames?.length ? { idle: { frames: entry.frames, frameRate: entry.frameRate ?? 16, repeat: 0 } } : undefined) }, `fx:${name}`);
        if (ref) effects.set(name, { ...ref, variants: entry.variants });
    }

    for (const [key, s] of Object.entries(m.sfx ?? {})) {
        if (s.path) {
            sfx.add(`sfx:${key}`);
            files.push({ kind: 'audio', key: `sfx:${key}`, urls: [assetUrl(s.path)] });
        }
    }

    return files;
}
