import type { Hex } from 'viem';
import { layoutHash } from './serialize';
import type { LevelFileV1 } from './types';

/**
 * Remix helpers (editor side). A remix is a copy of a published level with `meta.parentId` set; publishing it
 * calls `LevelNFT.publish(..., parentId, ...)` and mints a child LevelNFT. The contract refuses a layoutHash it has
 * already seen (`hashUsed`), and a remix that only differs by its metadata is not a remix, so the editor asks the
 * player to change the layout itself (tiles, elements, size, spawn or goal) before publishing.
 */

/** Same limit as the editor title input and the publish modal. */
export const LEVEL_NAME_MAX = 48;
const SUFFIX = ' (remix)';
export const REMIX_SOURCE_KEY = 'realmforge:editor:remix-source:v1';

/** What the editor remembers about the level being remixed (survives reloads, like the autosave). */
export interface RemixSource {
    id: number;
    name: string;
    /** On-chain layoutHash of the parent (keccak256 of its canonical JSON). */
    layoutHash: Hex;
    /** Hash of the parent's gameplay layout only (see `gameplayHash`). */
    gameplayHash: Hex;
}

/** `?remix=12` → 12; anything that is not a positive integer → null. */
export function parseRemixParam(value: string | null | undefined): number | null {
    if (!value || !/^\d+$/.test(value.trim())) return null;
    const n = Number(value.trim());
    return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** "Seesaw Hell" → "Seesaw Hell (remix)", trimmed to the 48-char name limit; an existing suffix is not doubled. */
export function remixName(name: string): string {
    const base = name.trim().replace(/ \(remix\)$/, '') || 'Untitled level';
    return base.slice(0, LEVEL_NAME_MAX - SUFFIX.length).trimEnd() + SUFFIX;
}

/** Hash of what you play: size, terrain, elements, spawn and goal. Metadata (name, theme, music, parentId…) is ignored. */
export function gameplayHash(file: LevelFileV1): Hex {
    return layoutHash({ size: file.size, layers: file.layers, entities: file.entities, spawn: file.spawn, goal: file.goal });
}

/** Editor copy of a published level, linked to it with `meta.parentId`. The parent's description is dropped. */
export function makeRemix(parent: LevelFileV1, parentId: number): LevelFileV1 {
    const copy = structuredClone(parent);
    const { description: _drop, ...meta } = copy.meta;
    void _drop;
    return { ...copy, meta: { ...meta, name: remixName(parent.meta.name), parentId } };
}

export function remixSourceOf(parent: LevelFileV1, parentId: number): RemixSource {
    return { id: parentId, name: parent.meta.name, layoutHash: layoutHash(parent), gameplayHash: gameplayHash(parent) };
}

export interface RemixStatus {
    /** 0 = original level. */
    parentId: number;
    /** The source we know about matches `parentId`. */
    known: boolean;
    /** The gameplay layout is still identical to the parent's: change something before publishing. */
    unchanged: boolean;
    /** Exactly the parent's bytes: LevelNFT.publish would revert with LayoutAlreadyUsed. */
    sameHash: boolean;
}

export function remixStatus(level: LevelFileV1, source: RemixSource | null | undefined): RemixStatus {
    const parentId = level.meta.parentId ?? 0;
    const known = Boolean(source && parentId > 0 && source.id === parentId);
    if (!known || !source) return { parentId, known: false, unchanged: false, sameHash: false };
    const sameHash = layoutHash(level) === source.layoutHash;
    return { parentId, known, sameHash, unchanged: sameHash || gameplayHash(level) === source.gameplayHash };
}

export function loadRemixSource(): RemixSource | null {
    try {
        const raw = localStorage.getItem(REMIX_SOURCE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw) as Partial<RemixSource>;
        return typeof s.id === 'number' && typeof s.gameplayHash === 'string' && typeof s.layoutHash === 'string' ? (s as RemixSource) : null;
    } catch {
        return null;
    }
}

export function saveRemixSource(source: RemixSource | null): void {
    try {
        if (source) localStorage.setItem(REMIX_SOURCE_KEY, JSON.stringify(source));
        else localStorage.removeItem(REMIX_SOURCE_KEY);
    } catch (err) {
        console.warn('[remix] could not store the remix source', err);
    }
}
