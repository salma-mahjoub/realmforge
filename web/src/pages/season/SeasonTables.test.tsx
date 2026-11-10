import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Address } from 'viem';
import type { SeasonStanding } from '../../api/types';
import { ClosedSeasonsList, PayoutsTable, StandingsTable, bpsToPct } from './SeasonTables';

const html = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const a = (i: number) => `0x${i.toString(16).padStart(40, '0')}` as Address;
const row = (i: number, winner: boolean, shareBps: number): SeasonStanding => ({ address: a(i), rank: i, score: 20 - i, reachedBlock: i, winner, shareBps, primary: 2, secondary: 1 });
const E18 = 10n ** 18n;

describe('season tables (static render)', () => {
    it('StandingsTable shows the prize of paid winners and dims the rest under the cut', () => {
        const out = html(<StandingsTable kind="players" rows={[row(1, true, 10_000), row(2, false, 0)]} pool={4n * E18} maxWinners={1} you={a(2)} />);
        expect(out).toContain('Player standings');
        expect(out).toContain('100.00%');
        expect(out).toContain('2 cleared · 1 record');
        expect(out).toMatch(/class="[^"]*season-unpaid[^"]*is-you[^"]*season-cut/);
        expect(out).toContain('not paid');
    });
    it('StandingsTable has an empty state per side', () => {
        expect(html(<StandingsTable kind="creators" rows={[]} pool={0n} maxWinners={10} />)).toContain('Creators score when other players pay');
    });
    it('PayoutsTable lists each winner and the dust kept in the pool', () => {
        const out = html(
            <PayoutsTable
                pool={10n}
                payouts={[
                    { kind: 'player', rank: 1, address: a(1), amount: 6n, shareBps: 6667n },
                    { kind: 'creator', rank: 1, address: a(2), amount: 3n, shareBps: 3333n },
                ]}
            />,
        );
        expect(out).toContain('Season payouts');
        expect(out).toContain('Creator');
        expect(out).toContain('66.67%');
        expect(out).toContain('rounding dust');
        expect(html(<PayoutsTable payouts={[]} />)).toContain('Nobody was paid');
    });
    it('ClosedSeasonsList shows each closed season with its payouts', () => {
        const out = html(<ClosedSeasonsList closed={[{ season: 1, pool: (5n * E18).toString(), block: 42, hash: '0x1', closedAt: 0, payouts: [{ position: 1, address: a(1), amount: (5n * E18).toString() }] }]} />);
        expect(out).toContain('Season 1');
        expect(out).toContain('block 42');
        expect(out).toContain('1 winner');
        expect(html(<ClosedSeasonsList closed={[]} />)).toContain('No season has been closed yet');
    });
    it('bpsToPct', () => expect(bpsToPct(2503)).toBe('25.03%'));
});
