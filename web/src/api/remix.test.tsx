import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { emptyLineage, lineageChain, mapLineage, type RemixLineageResponse } from './remix';
import type { LevelRow } from './types';

const row = (id: number, parent_id: number, extra: Partial<LevelRow> = {}): LevelRow => ({
    id,
    creator: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    owner: '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    layout_hash: '0x' + id.toString(16).padStart(64, '0'),
    parent_id,
    play_fee: '5000000000000000000',
    active: 1,
    plays: 3,
    clears: 1,
    likes: 0,
    best_time_ms: null,
    best_player: null,
    listing_price: null,
    created_at: 1_700_000_000_000,
    tx_hash: '0x' + 'ab'.repeat(32),
    level_cid: 'bafkreiexample',
    metadata_cid: null,
    thumbnail_cid: null,
    min_time_ms: null,
    name: `Level ${id}`,
    theme: 'grass',
    ...extra,
});

const raw: RemixLineageResponse = {
    levelId: 4,
    parentId: 2,
    ancestors: [row(1, 0), row(2, 1, { name: null })],
    children: [{ ...row(6, 4), remixes: 2 }],
    descendants: 3,
    truncated: false,
};

describe('remix lineage mapping', () => {
    it('maps server rows to summaries and keeps the remix counts', () => {
        const l = mapLineage(raw);
        expect(l.ancestors.map((a) => a.id)).toEqual([1, 2]);
        expect(l.ancestors[1].name).toBe('Level #2'); // unpinned level: rowToSummary fallback name
        expect(l.ancestors[0].creator).toBe('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'); // checksummed
        expect(l.children[0]).toMatchObject({ id: 6, remixes: 2, playFee: '5', plays: 3 });
        expect(l).toMatchObject({ levelId: 4, parentId: 2, descendants: 3, truncated: false });
    });

    it('builds the breadcrumb root first, ending on the current level', () => {
        const chain = lineageChain(mapLineage(raw), { id: 4, name: 'Me', creator: '0x1' });
        expect(chain.map((n) => (n.kind === 'level' ? `${n.id}${n.current ? '*' : ''}` : 'missing'))).toEqual(['1', '2', '4*']);
    });

    it('marks the unknown part of a truncated chain', () => {
        const parentUnknown = mapLineage({ ...raw, ancestors: [], parentId: 8, truncated: true });
        expect(lineageChain(parentUnknown, { id: 9, name: 'x', creator: '0x1' })[0]).toEqual({ kind: 'missing', id: 8 });
        const rootUnknown = mapLineage({ ...raw, ancestors: [row(2, 1)], truncated: true });
        const chain = lineageChain(rootUnknown, { id: 4, name: 'x', creator: '0x1' });
        expect(chain[0]).toEqual({ kind: 'missing', id: null });
        expect(chain).toHaveLength(3);
    });

    it('empty lineage of an original is not truncated', () => {
        expect(emptyLineage(7)).toEqual({ levelId: 7, parentId: 0, ancestors: [], children: [], descendants: 0, truncated: false });
        expect(emptyLineage(7, 3).truncated).toBe(true);
    });
});

describe('RemixLineage card', () => {
    it('renders a loading skeleton first (static render)', async () => {
        const { RemixLineage } = await import('../components/RemixLineage');
        const html = renderToStaticMarkup(
            <MemoryRouter>
                <RemixLineage id={4} name="Me" creator="0x1" canRemix />
            </MemoryRouter>,
        );
        expect(html).toContain('Remix lineage');
        expect(html).toContain('skeleton');
    });
});
