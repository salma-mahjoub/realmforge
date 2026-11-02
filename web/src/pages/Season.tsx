import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { CalendarClock, Crown, Hammer, RefreshCw, ShieldCheck, Trophy, Users } from 'lucide-react';
import { api } from '../api/client';
import { AddressChip, Badge, Button, Card, CardHeader, EmptyState, ForgeCoin, Skeleton, TokenAmount } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { parseSeasonProof, prizeOf, useSeason } from '../contracts/hooks';
import { BlockerNotice } from '../components/BlockerNotice';
import { useTxFlow, useWeb3Status } from '../web3/tx';

const fmtLeft = (sec: number) => {
    if (sec <= 0) return 'ended';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return d > 0 ? `${d}d ${h}h left` : h > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

/** Season page: prize pool, live ranking (docs/SEASONS.md) and, for the contract admin, the closing action. */
export default function Season() {
    const web3 = useWeb3Status();
    const season = useSeason();
    const tx = useTxFlow();
    const { data, error, loading, reload } = useAsync(() => api.getSeason(), []);
    const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
    useEffect(() => {
        const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
        return () => clearInterval(t);
    }, []);

    const ended = season.seasonEnd !== undefined && now >= season.seasonEnd;
    const pool = season.pool ?? 0n;
    const nPlayers = data?.players.length ?? 0;

    const closeSeason = async () => {
        const out = await tx.run('close-season', { title: 'Close the season', success: 'Season closed', successBody: 'The pool was paid to the winners and the next season started.' }, async () => {
            const proof = parseSeasonProof(await api.requestSeasonProof());
            if (!proof) throw new Error('The server returned an incomplete season proof.');
            return season.close(proof);
        });
        if (out.ok) {
            void season.refetch();
            reload();
        }
    };

    const winners = (list: { address: string; score: number }[], offset: number, label: string, icon: React.ReactNode) => (
        <Card>
            <CardHeader icon={icon} title={label} aside={<Badge tone="neutral">{list.length} / 10</Badge>} />
            {loading && !data ? (
                <Skeleton w="100%" h={120} />
            ) : list.length === 0 ? (
                <EmptyState compact title="No score yet">Scores appear after the first settled runs of the season.</EmptyState>
            ) : (
                <ol className="plain-steps" aria-label={label}>
                    {list.map((w, i) => (
                        <li key={w.address} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                <b>{i + 1}</b>
                                <AddressChip address={w.address} avatar />
                            </span>
                            <span style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                                <span className="fine">{w.score} pts</span>
                                <TokenAmount value={Number(formatEther(prizeOf(pool, data!.shares[offset + i] ?? 0)))} size="sm" />
                            </span>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    );

    return (
        <div className="page page-season">
            <header className="page-head">
                <div>
                    <h1 className="page-title">Season {season.season !== undefined ? season.season.toString() : '…'}</h1>
                    <p className="page-sub">20% of every play fee and 5% of every race pot feed the prize pool. At the end of the season it is shared between the top players and the top creators.</p>
                </div>
                <dl className="inline-stats">
                    <div>
                        <dt>Prize pool</dt>
                        <dd>{season.pool !== undefined ? <TokenAmount value={Number(formatEther(pool))} size="lg" /> : '—'}</dd>
                    </div>
                    <div>
                        <dt>
                            <CalendarClock size={13} aria-hidden /> Ends
                        </dt>
                        <dd>{season.seasonEnd !== undefined ? fmtLeft(season.seasonEnd - now) : '—'}</dd>
                    </div>
                </dl>
            </header>

            {error && !data && (
                <EmptyState tone="error" title="The ranking could not be loaded" action={<Button icon={<RefreshCw size={15} aria-hidden />} onClick={reload}>Retry</Button>}>
                    {error.message}
                </EmptyState>
            )}

            <div className="room-new-grid">
                {winners(data?.players ?? [], 0, 'Top players', <Trophy size={18} />)}
                {winners(data?.creators ?? [], nPlayers, 'Top creators', <Crown size={18} />)}
            </div>

            <Card>
                <CardHeader icon={<Users size={18} />} title="How the ranking works" />
                <ul className="plain-steps">
                    <li>Players: +1 point per level cleared (once per level) and +2 per level where they hold the best settled time.</li>
                    <li>Creators: +1 point per different player who paid to play one of their levels.</li>
                    <li>Playing your own level never scores. The pool is split 50% players, 50% creators, in proportion to the points.</li>
                    <li>The server computes the ranking from public on-chain events and signs it; only the admin can submit it, after the season ends.</li>
                </ul>
            </Card>

            {web3.address && season.isAdmin && (
                <Card>
                    <CardHeader icon={<ShieldCheck size={18} />} title="Admin: close the season" aside={<ForgeCoin size={18} />} />
                    <p className="fine">
                        {ended
                            ? `The season is over. Closing it pays ${Number(formatEther(pool)).toLocaleString()} FORGE to the winners above and starts season ${season.season !== undefined ? (season.season + 1n).toString() : '…'}.`
                            : 'The contract only accepts the closing after the season end.'}
                    </p>
                    <BlockerNotice compact />
                    <Button variant="primary" icon={<Hammer size={16} aria-hidden />} disabled={!ended || !!web3.blocker} loading={tx.isBusy('close-season')} onClick={() => void closeSeason()}>
                        Close season {season.season?.toString()}
                    </Button>
                </Card>
            )}
        </div>
    );
}
