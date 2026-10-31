/**
 * Bridge between the web level file (level.v1, SPEC §3.4) and game-core's element factories
 * (`ELEMENTS[type].create`, `createElementRuntime`).
 *
 * Level files store entities by their bottom-left tile (integer x/y, what the editor shows);
 * game-core expects tile-space centres. Props are game-core descriptors (`ELEMENT_PROPS`) and are
 * sanitised here so older/hand-written levels (e.g. `direction: 'left'`, out-of-range speeds) never
 * make `normalizeProps` throw at runtime.
 */
import { ELEMENT_PROPS, ELEMENT_TYPES, type ElementDef as CoreElementDef, type ElementType } from '@realmforge/game-core';
import type { LevelEntity, Theme, Waypoint } from '../level/types';
import { elementTexture, type TextureRef } from '../assets/registry';

/** Pre-integration names that may still exist in autosaves / imported files. */
const LEGACY_TYPES: Record<string, ElementType> = {
    question: 'question_block',
    oneway: 'one_way',
    semisolid: 'semi_solid',
    pendulum: 'pendulum_ball',
    conveyor: 'conveyor_belt',
    lock_door: 'locked_door',
};

const KNOWN = new Set<string>(ELEMENT_TYPES);

export function canonicalType(type: string): ElementType | null {
    const t = LEGACY_TYPES[type] ?? type;
    return KNOWN.has(t) ? (t as ElementType) : null;
}

const DIRECTION: Record<string, number> = { left: -1, up: -1, right: 1, down: 1 };

/** Keep only props game-core knows, coerced into the descriptor's kind and range. */
export function sanitizeProps(type: ElementType, props: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!props) return out;
    for (const d of ELEMENT_PROPS[type]) {
        let v = props[d.name];
        if (v === undefined || v === null) continue;
        switch (d.kind) {
            case 'number':
                if (typeof v === 'string' && d.name === 'direction') v = DIRECTION[v];
                if (typeof v !== 'number' || !Number.isFinite(v)) continue;
                out[d.name] = Math.min(d.max ?? v, Math.max(d.min ?? v, v));
                break;
            case 'boolean':
                if (typeof v === 'boolean') out[d.name] = v;
                break;
            case 'string':
                if (typeof v === 'string' || typeof v === 'number') out[d.name] = String(v);
                break;
            case 'link':
                if ((typeof v === 'string' && v !== '') || typeof v === 'number') out[d.name] = v;
                break;
            case 'path':
                if (Array.isArray(v)) {
                    const pts = v.filter((p): p is Waypoint => !!p && Number.isFinite((p as Waypoint).x) && Number.isFinite((p as Waypoint).y));
                    out[d.name] = pts.map((p) => ({ x: p.x, y: p.y }));
                }
                break;
        }
    }
    return out;
}

const num = (type: ElementType, props: Record<string, unknown>, name: string): number => {
    const v = props[name];
    if (typeof v === 'number') return v;
    const d = ELEMENT_PROPS[type].find((p) => p.name === name);
    return typeof d?.default === 'number' ? d.default : 1;
};

/** Footprint in tiles of an element, matching the bodies game-core creates. */
export function footprint(type: ElementType, props: Record<string, unknown> = {}): { w: number; h: number } {
    const p = sanitizeProps(type, props);
    const w = num(type, p, 'width');
    const h = num(type, p, 'height');
    if (type === 'seesaw') return { w: w * num(type, p, 'length'), h };
    if (type === 'chain_bridge') return { w: num(type, p, 'length') + 1, h };
    return { w, h };
}

/** Bottom-left tile anchor → tile-space centre for an element of size w×h. */
function centre(type: ElementType, x: number, y: number, size: { w: number; h: number }) {
    // chain_bridge: game-core puts the first plank's centre on def.x and extends to the right.
    const cx = type === 'chain_bridge' ? x + 0.5 : x + size.w / 2;
    return { x: cx, y: y + 1 - size.h / 2 };
}

/** level.v1 entity → game-core ElementDef (or null for unknown types / `start`, a pure marker). */
export function toCoreDef(e: Pick<LevelEntity, 'id' | 'x' | 'y' | 'props'> & { type: string }): CoreElementDef | null {
    const type = canonicalType(e.type);
    if (!type) return null;
    const props = sanitizeProps(type, e.props);
    const size = footprint(type, props);
    const c = centre(type, e.x, e.y, size);
    if (Array.isArray(props.path)) props.path = (props.path as Waypoint[]).map((p) => centre(type, p.x, p.y, size));
    return { id: e.id, type, x: c.x, y: c.y, props };
}

/** Terrain tile (grid cell) → game-core ElementDef. Ids are strings so they never clash with entity ids. */
export function terrainDef(type: ElementType, x: number, y: number, run = 1): CoreElementDef {
    return { id: `t:${x}:${y}`, type, x: x + run / 2, y: y + 0.5, props: run !== 1 ? { width: run } : {} };
}

/** Manifest textures (theme variants first, then generic, then generated placeholders) per element type. */
export function coreTextures(theme: Theme): Record<string, Omit<TextureRef, 'key'> & { texture: string }> {
    const out: Record<string, Omit<TextureRef, 'key'> & { texture: string }> = {};
    for (const type of ELEMENT_TYPES) {
        const ref = elementTexture(type, theme);
        const art = type === 'chain_bridge' && ref.key === 'chain_bridge' ? elementTexture('seesaw', theme) : ref;
        out[type] = { ...art, texture: art.key };
    }
    return out;
}
