import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAMPLE_LEVEL } from './index';
import { layoutHash } from './serialize';
import { LEVEL_NAME_MAX, REMIX_SOURCE_KEY, gameplayHash, loadRemixSource, makeRemix, parseRemixParam, remixName, remixSourceOf, remixStatus, saveRemixSource } from './remix';
import type { LevelFileV1 } from './types';

const parent: LevelFileV1 = { ...structuredClone(SAMPLE_LEVEL), meta: { ...SAMPLE_LEVEL.meta, description: 'the original' } };

describe('remix helpers', () => {
    it('parses ?remix= as a positive integer only', () => {
        expect(parseRemixParam('12')).toBe(12);
        expect(parseRemixParam(' 7 ')).toBe(7);
        for (const bad of [null, undefined, '', '0', '-3', '1.5', 'abc', '#12', '99999999999999999999']) expect(parseRemixParam(bad)).toBeNull();
    });

    it('names the copy "<name> (remix)" within the 48-char limit, without doubling the suffix', () => {
        expect(remixName('Seesaw Hell')).toBe('Seesaw Hell (remix)');
        expect(remixName('Seesaw Hell (remix)')).toBe('Seesaw Hell (remix)');
        expect(remixName('   ')).toBe('Untitled level (remix)');
        const long = remixName('x'.repeat(60));
        expect(long.length).toBeLessThanOrEqual(LEVEL_NAME_MAX);
        expect(long.endsWith(' (remix)')).toBe(true);
    });

    it('makeRemix copies the layout, sets parentId, renames and drops the description', () => {
        const copy = makeRemix(parent, 12);
        expect(copy.meta.parentId).toBe(12);
        expect(copy.meta.name).toBe(remixName(parent.meta.name));
        expect(copy.meta.description).toBeUndefined();
        expect(copy.meta.theme).toBe(parent.meta.theme);
        expect(gameplayHash(copy)).toBe(gameplayHash(parent));
        // deep copy: editing the remix never touches the parent object
        copy.entities[0].x += 1;
        expect(copy.entities[0].x).not.toBe(parent.entities[0].x);
    });

    it('gameplayHash ignores metadata but sees every layout change', () => {
        const base = gameplayHash(parent);
        expect(gameplayHash({ ...parent, meta: { ...parent.meta, name: 'other', theme: 'snow', parentId: 3 } })).toBe(base);
        expect(gameplayHash({ ...parent, spawn: { ...parent.spawn, x: parent.spawn.x + 1 } })).not.toBe(base);
        expect(gameplayHash({ ...parent, goal: { ...parent.goal, y: parent.goal.y - 1 } })).not.toBe(base);
        expect(gameplayHash({ ...parent, entities: parent.entities.slice(1) })).not.toBe(base);
        expect(gameplayHash({ ...parent, layers: { terrain: parent.layers.terrain + 'x' } })).not.toBe(base);
    });

    it('remixStatus flags an untouched copy, and clears once the layout changes', () => {
        const source = remixSourceOf(parent, 12);
        expect(source).toMatchObject({ id: 12, name: parent.meta.name, layoutHash: layoutHash(parent) });

        const copy = makeRemix(parent, 12);
        expect(remixStatus(copy, source)).toEqual({ parentId: 12, known: true, unchanged: true, sameHash: false });
        // A full copy already hashes differently (parentId + name are in the canonical JSON), which is why the
        // editor compares gameplay, not the raw layoutHash.
        expect(layoutHash(copy)).not.toBe(source.layoutHash);

        const edited = { ...copy, goal: { ...copy.goal, x: copy.goal.x - 1 } };
        expect(remixStatus(edited, source)).toMatchObject({ known: true, unchanged: false });
    });

    it('remixStatus: exact parent bytes would revert on-chain (LayoutAlreadyUsed)', () => {
        const source = remixSourceOf(parent, 12);
        const same = { ...parent, meta: { ...parent.meta, parentId: 12 } };
        const sourceOfSame = { ...source, layoutHash: layoutHash(same) };
        expect(remixStatus(same, sourceOfSame)).toMatchObject({ sameHash: true, unchanged: true });
    });

    it('remixStatus ignores a source for another parent and original levels', () => {
        const source = remixSourceOf(parent, 12);
        expect(remixStatus(makeRemix(parent, 5), source)).toEqual({ parentId: 5, known: false, unchanged: false, sameHash: false });
        expect(remixStatus(parent, source)).toEqual({ parentId: 0, known: false, unchanged: false, sameHash: false });
        expect(remixStatus(makeRemix(parent, 12), null).known).toBe(false);
    });
});

describe('remix source storage', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('round-trips through localStorage and can be cleared', () => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => store.get(k) ?? null,
            setItem: (k: string, v: string) => void store.set(k, v),
            removeItem: (k: string) => void store.delete(k),
        });
        expect(loadRemixSource()).toBeNull();
        const source = remixSourceOf(parent, 4);
        saveRemixSource(source);
        expect(loadRemixSource()).toEqual(source);
        store.set(REMIX_SOURCE_KEY, '{"id":"nope"}');
        expect(loadRemixSource()).toBeNull();
        store.set(REMIX_SOURCE_KEY, 'not json');
        expect(loadRemixSource()).toBeNull();
        saveRemixSource(null);
        expect(store.has(REMIX_SOURCE_KEY)).toBe(false);
    });
});
