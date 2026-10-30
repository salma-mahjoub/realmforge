import { keccak256, toBytes } from 'viem';
import { decodeRle, encodeRle } from './rle';
import {
    LEVEL_SCHEMA_VERSION,
    MAX_LEVEL_H,
    MAX_LEVEL_W,
    type LevelDoc,
    type LevelFileV1,
} from './types';

export function decodeLevel(file: LevelFileV1): LevelDoc {
    if (file.schema !== LEVEL_SCHEMA_VERSION) throw new Error(`Unsupported level schema ${String(file.schema)}`);
    const { w, h } = file.size;
    if (w < 1 || h < 1 || w > MAX_LEVEL_W || h > MAX_LEVEL_H) throw new Error(`Level size ${w}x${h} out of bounds`);
    return {
        meta: { ...file.meta },
        size: { ...file.size },
        terrain: decodeRle(file.layers.terrain, w * h),
        entities: file.entities.map((e) => ({ ...e, props: e.props ? structuredClone(e.props) : undefined })),
        spawn: { ...file.spawn },
        goal: { ...file.goal },
    };
}

export function encodeLevel(doc: LevelDoc): LevelFileV1 {
    return {
        schema: LEVEL_SCHEMA_VERSION,
        meta: { ...doc.meta },
        size: { ...doc.size },
        layers: { terrain: encodeRle(doc.terrain) },
        entities: [...doc.entities]
            .sort((a, b) => a.id - b.id)
            .map((e) => (e.props && Object.keys(e.props).length ? { ...e } : { id: e.id, type: e.type, x: e.x, y: e.y })),
        spawn: { ...doc.spawn },
        goal: { ...doc.goal },
    };
}

export function createEmptyLevel(w = 120, h = 30, theme: LevelDoc['meta']['theme'] = 'grass'): LevelDoc {
    const terrain = new Uint8Array(w * h);
    // two rows of ground at the bottom
    terrain.fill(1, (h - 2) * w, h * w);
    return {
        meta: { name: 'Untitled level', theme, timeLimit: 300, music: `${theme}_01` },
        size: { w, h, tile: 64 },
        terrain,
        entities: [],
        spawn: { x: 2, y: h - 3 },
        goal: { x: w - 4, y: h - 3 },
    };
}

/**
 * Canonical JSON for `layoutHash` — byte-for-byte identical to server/src/level/canonical.ts:
 *  - object keys sorted by UTF-16 code unit order (JS default sort), recursively
 *  - no insignificant whitespace; strings/numbers/booleans/null exactly as JSON.stringify
 *  - `undefined` object members omitted, `undefined` array items → null; non-finite numbers rejected
 *  - UTF-8 encoding of the resulting string
 * Shared test vectors: ../../../../test-vectors/layout-hash.json (checked by web and server tests).
 */
export function canonicalize(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
        case 'number':
            if (!Number.isFinite(value)) throw new TypeError('non-finite number in canonical JSON');
            return JSON.stringify(value);
        case 'string':
        case 'boolean':
            return JSON.stringify(value);
        case 'object': {
            if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`;
            const obj = value as Record<string, unknown>;
            const keys = Object.keys(obj)
                .filter((k) => obj[k] !== undefined)
                .sort();
            return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
        }
        default:
            throw new TypeError(`unsupported type in canonical JSON: ${typeof value}`);
    }
}

/** `layoutHash = keccak256(canonicalJSONBytes)` (SPEC §3.4). Must match server/ implementation. */
export function layoutHash(file: LevelFileV1 | unknown): `0x${string}` {
    return keccak256(toBytes(canonicalize(file)));
}
