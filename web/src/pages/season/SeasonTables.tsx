import { formatEther } from 'viem';
import type { ClosedSeason, SeasonStanding } from '../../api/types';
import { AddressChip, EmptyState, TokenAmount, cx } from '../../components/ui';
import { prizeOf, type SeasonPayout } from '../../contracts/hooks/useSeason';

const forge = (wei: bigint | string) => Number(formatEther(typeof wei === 'string' ? BigInt(wei) : wei));
export const bpsToPct = (bps: number | bigint) => `${(Number(bps) / 100).toFixed(2)}%`;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * Live standings of one side (players or creators). Every scorer is listed; the paid top `maxWinners` come first and
 * show the prize they would receive if the season closed now, the others are dimmed under a "not paid" divider.
 */
export function StandingsTable({ kind, rows, pool, maxWinners, you }: { kind: 'players' | 'creators'; rows: SeasonStanding[]; pool: bigint; maxWinners: number; you?: string }) {
    if (rows.length === 0) {
        return (
            <EmptyState compact title="No score yet">
                {kind === 'players' ? 'Clear a level someone else made to score this season.' : 'Creators score when other players pay to play their levels.'}
            </EmptyState>
        );
    }
    const breakdown = (r: SeasonStanding) =>
        kind === 'players' ? `${r.primary} cleared · ${r.secondary} record${r.secondary === 1 ? '' : 's'}` : `${r.primary} player${r.primary === 1 ? '' : 's'} · ${r.secondary} level${r.secondary === 1 ? '' : 's'}`;
    return (
        <table className="table season-table" aria-label={kind === 'players' ? 'Player standings' : 'Creator standings'}>
            <thead>
                <tr>
                    <th>#</th>
                    <th>{kind === 'players' ? 'Player' : 'Creator'}</th>
                    <th className="num-col">Points</th>
                    <th className="num-col">Prize now</th>
                </tr>
            </thead>
            <tbody>
                {rows.map((r) => (
                    <tr key={r.address} className={cx(!r.winner && 'season-unpaid', same(r.address, you) && 'is-you', r.rank === maxWinners + 1 && 'season-cut')}>
                        <td>
                            <span className={cx('rank', r.rank <= 3 && `rank-${r.rank}`)}>{r.rank}</span>
                        </td>
                        <td>
                            <AddressChip address={r.address} avatar copy={false} />
                            <div className="fine season-breakdown">{breakdown(r)}</div>
                        </td>
                        <td className="num-col">
                            <b>{r.score}</b>
                        </td>
                        <td className="num-col">
                            {r.winner ? (
                                <>
                                    <TokenAmount value={forge(prizeOf(pool, r.shareBps))} size="sm" />
                                    <div className="fine">{bpsToPct(r.shareBps)}</div>
                                </>
                            ) : (
                                <span className="fine">not paid</span>
                            )}
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/** What `closeSeason` paid, from the transaction receipt: side, rank, winner, share and FORGE received. */
export function PayoutsTable({ payouts, pool }: { payouts: SeasonPayout[]; pool?: bigint }) {
    const paid = payouts.reduce((a, p) => a + p.amount, 0n);
    if (payouts.length === 0) return <EmptyState compact title="Nobody was paid">The season had no winner: the whole pool rolls over to the next season.</EmptyState>;
    return (
        <>
            <table className="table season-table" aria-label="Season payouts">
                <thead>
                    <tr>
                        <th>Side</th>
                        <th>#</th>
                        <th>Winner</th>
                        <th className="num-col">Share</th>
                        <th className="num-col">Paid</th>
                    </tr>
                </thead>
                <tbody>
                    {payouts.map((p) => (
                        <tr key={`${p.kind}-${p.address}`}>
                            <td>{p.kind === 'player' ? 'Player' : 'Creator'}</td>
                            <td>{p.rank}</td>
                            <td>
                                <AddressChip address={p.address} avatar copy={false} />
                            </td>
                            <td className="num-col">{bpsToPct(p.shareBps)}</td>
                            <td className="num-col">
                                <TokenAmount value={forge(p.amount)} size="sm" sign="+" />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="fine season-total">
                Total paid <b>{forge(paid).toLocaleString(undefined, { maximumFractionDigits: 4 })} FORGE</b>
                {pool !== undefined && pool > paid && <> · {formatEther(pool - paid)} FORGE of rounding dust stays in the pool</>}
            </p>
        </>
    );
}

/** Closed seasons from the indexer, each with the transfers its closeSeason made. */
export function ClosedSeasonsList({ closed }: { closed: ClosedSeason[] }) {
    if (closed.length === 0) return <p className="fine">No season has been closed yet.</p>;
    return (
        <ul className="season-history">
            {closed.map((s) => (
                <li key={s.season}>
                    <div className="season-history-head">
                        <b>Season {s.season}</b>
                        <span className="fine">
                            pool <TokenAmount value={forge(s.pool)} size="sm" /> · block {s.block} · {s.payouts.length} winner{s.payouts.length === 1 ? '' : 's'}
                        </span>
                    </div>
                    {s.payouts.length > 0 && (
                        <ol className="season-history-payouts">
                            {s.payouts.map((p) => (
                                <li key={p.position}>
                                    <AddressChip address={p.address} copy={false} />
                                    <TokenAmount value={forge(p.amount)} size="sm" sign="+" />
                                </li>
                            ))}
                        </ol>
                    )}
                </li>
            ))}
        </ul>
    );
}
