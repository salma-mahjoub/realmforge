import { rowToSummary } from './client';
import type { LevelRow, LevelSummary } from './types';

/** Raw GET /levels/:id/remixes (server/src/api/routes/remix.ts). */
export interface RemixLineageResponse {
    levelId: number;
    parentId: number;
    ancestors: LevelRow[];
    children: (LevelRow & { remixes: number })[];
    descendants: number;
    truncated: boolean;
}

export interface RemixLineage {
    levelId: number;
    parentId: number;
    /** Root (original) first, direct parent last. */
    ancestors: LevelSummary[];
    /** Direct remixes, oldest first, with their own direct remix count. */
    children: (LevelSummary & { remixes: number })[];
    /** Size of the whole remix subtree below the level. */
    descendants: number;
    /** An ancestor is missing from the index: the chain stops early. */
    truncated: boolean;
}

export const emptyLineage = (levelId: number, parentId = 0): RemixLineage => ({ levelId, parentId, ancestors: [], children: [], descendants: 0, truncated: parentId > 0 });

export function mapLineage(raw: RemixLineageResponse): RemixLineage {
    return {
        levelId: raw.levelId,
        parentId: raw.parentId,
        ancestors: raw.ancestors.map(rowToSummary),
        children: raw.children.map((c) => ({ ...rowToSummary(c), remixes: c.remixes ?? 0 })),
        descendants: raw.descendants,
        truncated: raw.truncated,
    };
}

export type ChainNode =
    | { kind: 'level'; id: number; name: string; creator: string; current: boolean }
    /** Placeholder for the part of the chain the indexer does not know. */
    | { kind: 'missing'; id: number | null };

/**
 * The breadcrumb shown on the level page: [missing?] root → … → parent → this level.
 * When the chain is truncated, the first unknown ancestor is the parent of the oldest known one
 * (or the level's own parent when none is known); its id is only known in the second case.
 */
export function lineageChain(l: RemixLineage, self: { id: number; name: string; creator: string }): ChainNode[] {
    const nodes: ChainNode[] = l.ancestors.map((a) => ({ kind: 'level', id: a.id, name: a.name, creator: a.creator, current: false }));
    if (l.truncated) nodes.unshift({ kind: 'missing', id: l.ancestors.length ? null : l.parentId || null });
    nodes.push({ kind: 'level', id: self.id, name: self.name, creator: self.creator, current: true });
    return nodes;
}
