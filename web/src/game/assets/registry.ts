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
}

export type ManifestFile =
    | { kind: 'image'; key: string; url: string }
    | { kind: 'atlas'; key: string; textureURL: string; atlasURL: string }
    | { kind: 'audio'; key: string; urls: string[] };

export interface AnimDef {
    key: string;
    texture: string;
    frames: string[];
    frameRate: number;
    repeat: number;
}

interface ImageEntry {
    texture?: string;
    path?: string;
    image?: string;
    atlas?: string;
    frame?: string | number;
    animations?: Record<string, { frames?: string[]; frameRate?: number; repeat?: number }>;
}

interface ManifestV1 {
    schema?: number;
    baseUrl?: string;
    elements?: Record<string, ImageEntry>;
    characters?: Record<string, ImageEntry>;
    enemies?: Record<string, ImageEntry>;
    themes?: Record<string, ImageEntry & { background?: ImageEntry }>;
    sfx?: Record<string, { path?: string }>;
}

/** Our element ids → names used by the asset pack (first match wins). */
const ALIASES: Partial<Record<ElementType | 'player', string[]>> = {
    oneway: ['one_way', 'one-way', 'oneWay'],
    semisolid: ['semi_solid', 'semi-solid'],
    question: ['question', 'question_block'],
    pendulum: ['pendulum', 'wrecking_ball', 'pendulum_ball'],
    lock_door: ['locked_door', 'key-lock-door', 'lockedDoor'],
    big_coin: ['big_coin', 'bigCoin'],
    powerup_double_jump: ['powerup_double_jump', 'double-jump'],
    powerup_dash: ['powerup_dash', 'dash'],
    chain_bridge: ['chain_bridge', 'chain'],
    conveyor: ['conveyor', 'conveyor_belt'],
};

/** Preferred playable character for the local player (violet, like the mockups). */
const PLAYER_CHARACTERS = ['purple', 'green', 'pink', 'beige'];

let base = '/assets/';

/** Resolve a manifest path relative to the manifest's baseUrl (default /assets/). */
export function assetUrl(p: string): string {
    if (/^(https?:)?\/\//.test(p) || p.startsWith('/') || p.startsWith('data:')) return p;
    return `${base}${p.replace(/^\.\//, '')}`;
}

const elementTextures = new Map<string, TextureRef>();
const themedTextures = new Map<string, TextureRef>(); // `${theme}:${type}`
const backgrounds = new Map<string, string>();
const animations: AnimDef[] = [];
const sfx = new Set<string>();

export function placeholderKey(type: string): string {
    return `ph:${type}`;
}

/** Texture for an element; prefers a theme-specific variant (e.g. `snow_ground`). */
export function elementTexture(type: ElementType | 'player', theme?: Theme | string): TextureRef {
    return (theme && themedTextures.get(`${theme}:${type}`)) || elementTextures.get(type) || { key: placeholderKey(type) };
}

export function themeBackground(theme: string): string | undefined {
    return backgrounds.get(theme);
}

export function getAnimations(): readonly AnimDef[] {
    return animations;
}

export function hasSfx(key: string): boolean {
    return sfx.has(key);
}

/** Drop mappings whose texture failed to load so lookups fall back to placeholders. */
export function pruneMissing(exists: (key: string) => boolean): void {
    for (const map of [elementTextures, themedTextures]) {
        for (const [k, ref] of map) if (!exists(ref.key)) map.delete(k);
    }
    for (const [k, key] of backgrounds) if (!exists(key)) backgrounds.delete(k);
}

/**
 * Build the load list + element texture map from the manifest. Pure (no Phaser).
 * Unknown/unsupported sections are ignored rather than guessed at.
 */
export function readManifest(manifest: unknown, knownTypes: readonly string[]): ManifestFile[] {
    const m = (manifest ?? {}) as ManifestV1;
    base = typeof m.baseUrl === 'string' ? (m.baseUrl.endsWith('/') ? m.baseUrl : `${m.baseUrl}/`) : '/assets/';
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
        if (e.atlas && img) {
            if (!loaded.has(key)) {
                loaded.add(key);
                files.push({ kind: 'atlas', key, textureURL: assetUrl(img), atlasURL: assetUrl(e.atlas) });
                for (const [name, a] of Object.entries(e.animations ?? {})) {
                    if (a.frames?.length) animations.push({ key: `${key}:${name}`, texture: key, frames: a.frames, frameRate: a.frameRate ?? 8, repeat: a.repeat ?? -1 });
                }
            }
            return { key, frame: e.frame ?? e.animations?.idle?.frames?.[0] };
        }
        if (img && /\.(png|jpe?g|webp)$/i.test(img)) {
            if (!loaded.has(key)) {
                loaded.add(key);
                files.push({ kind: 'image', key, url: assetUrl(img) });
            }
            return { key };
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
    for (const name of PLAYER_CHARACTERS) {
        const ref = queue(chars[name], `characters-${name}`);
        if (ref) {
            elementTextures.set('player', ref);
            break;
        }
    }

    for (const [theme, t] of Object.entries(m.themes ?? {})) {
        const ref = queue(t.background, `background_${theme}`);
        if (ref) backgrounds.set(theme, ref.key);
    }

    for (const [key, s] of Object.entries(m.sfx ?? {})) {
        if (s.path) {
            sfx.add(`sfx:${key}`);
            files.push({ kind: 'audio', key: `sfx:${key}`, urls: [assetUrl(s.path)] });
        }
    }

    return files;
}
