import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keccak256, toHex } from 'viem';
import { canonicalize, decodeLevel, encodeLevel, layoutHash } from './serialize';
import type { LevelFileV1 } from './types';

/** Shared with server/test/canonical.test.ts — both must produce the same bytes and hash. */
const ROOT = resolve(__dirname, '../../../..');
const VECTORS = resolve(ROOT, 'test-vectors/layout-hash.json');
type Vector = { name: string; file?: string; level?: unknown; canonical?: string; canonicalBytes?: number; layoutHash: string };
const { vectors } = JSON.parse(readFileSync(VECTORS, 'utf8')) as { vectors: Vector[] };

describe('layoutHash (shared web/server vectors)', () => {
    it('has vectors', () => expect(vectors.length).toBeGreaterThanOrEqual(2));
    for (const v of vectors) {
        it(v.name, () => {
            const level = v.file ? JSON.parse(readFileSync(resolve(ROOT, v.file), 'utf8')) : v.level;
            const canonical = canonicalize(level);
            if (v.canonical) expect(canonical).toBe(v.canonical);
            if (v.canonicalBytes) expect(new TextEncoder().encode(canonical).length).toBe(v.canonicalBytes);
            expect(layoutHash(level)).toBe(v.layoutHash);
            expect(keccak256(toHex(canonical))).toBe(v.layoutHash);
        });
    }
});

describe('level file round trip', () => {
    it('decode → encode keeps the sample level hash (editor does not perturb published bytes)', () => {
        const v = vectors.find((x) => x.file)!;
        expect(existsSync(resolve(ROOT, v.file!))).toBe(true);
        const file = JSON.parse(readFileSync(resolve(ROOT, v.file!), 'utf8')) as LevelFileV1;
        expect(layoutHash(encodeLevel(decodeLevel(file)))).toBe(v.layoutHash);
    });

    it('matches server rules for undefined / non-finite values', () => {
        expect(canonicalize({ b: 1, a: undefined, c: [undefined] })).toBe('{"b":1,"c":[null]}');
        expect(() => canonicalize({ x: Number.NaN })).toThrow();
    });
});
