import { useEffect, useState } from 'react';
import { formatEther } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, CheckCircle2, Crown, FileSignature, Hammer, History, RefreshCw, ShieldCheck, Trophy, Users } from 'lucide-react';
import { api } from '../api/client';
import { Badge, Button, Card, CardHeader, EmptyState, ForgeCoin, Pill, Skeleton, TokenAmount, cx } from '../components/ui';
import { formatCountdown, parseSeasonProof, payoutsFromReceipt, secondsLeft, useSeason, type SeasonPayout, type SignedSeason } from '../contracts/hooks';
import { BlockerNotice } from '../components/BlockerNotice';
import { useTxFlow, useWeb3Status } from '../web3/tx';
import { ClosedSeasonsList, PayoutsTable, StandingsTable, bpsToPct } from './season/SeasonTables';
import './season/season.css';

interface FetchedProof {
    season: number;
    signer: string;
    signed: SignedSeason;
}

/**
 * Season page: live standings (docs/SEASONS.md, GET /season/standings), the on-chain prize pool and a countdown to
 * `seasonEnd` by the chain clock, and for the contract admin the two-step close: fetch the server-signed result,
 * then submit `ForgeCoin.closeSeason` and show what each winner was paid.
 */
export default function Season() {
    const web3 = useWeb3Status();
    const season = useSeason();
    const tx = useTxFlow();
    const standingsQ = useQuery({ queryKey: ['season', 'standings'], queryFn: () => api.getSeasonStandings(), refetchInterval: 10_000 });
    const data = standingsQ.data;

    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        const t = setInterval(() => setNowMs(Date.now()), 1_000);
        return () => clearInterval(t);
    }, []);

    const [proof, setProof] = useState<FetchedProof | null>(null);
    const [proofError, setProofError] = useState<string | null>(null);
    const [fetchingProof, setFetchingProof] = useState(false);
    const [result, setResult] = useState<{ season: bigint; pool: bigint; payouts: SeasonPayout[] } | null>(null);

    const left = season.seasonEnd !== undefined ? secondsLeft(season.seasonEnd, season.chainTs, season.chainTsObservedAt, nowMs) : undefined;
    const ended = left !== undefined && left <= 0;
    const pool = season.pool ?? 0n;
    const onChainSeason = season.season;
    const proofMatches = proof !== null && onChainSeason !== undefined && BigInt(proof.season) === onChainSeason;
    const isLocal = web3.chainId === 31337;

    const fetchProof = async () => {
        setFetchingProof(true);
        setProofError(null);
        try {
            const raw = (await api.requestSeasonProof()) as { message?: { season?: string }; signer?: string };
            const signed = parseSeasonProof(raw);
            if (!signed || !raw.message?.season) throw new Error('The server returned an incomplete season proof.');
            setProof({ season: Number(raw.message.season), signer: raw.signer ?? '—', signed });
        } catch (e) {
            setProof(null);
            setProofError((e as Error).message);
        } finally {
            setFetchingProof(false);
        }
    };

    const closeSeason = async () => {
        if (!proof || onChainSeason === undefined) return;
        const closing = onChainSeason;
        const poolBefore = pool;
        const out = await tx.run('close-season', { title: `Close season ${closing}`, success: `Season ${closing} closed`, successBody: 'The pool was paid to the winners and the next season started.' }, () =>
            season.close(proof.signed),
        );
        if (out.ok && out.receipt) {
            setResult({ season: closing, pool: poolBefore, payouts: payoutsFromReceipt(out.receipt, season.forgeCoin, proof.signed) });
            setProof(null);
            void season.refetch();
            void standingsQ.refetch();
        }
    };

    const step = result ? 3 : proof ? 2 : 1;
    const np = proof?.signed.players.length ?? 0;
    const nc = proof?.signed.creators.length ?? 0;
    const maxWinners = data?.maxWinners ?? 10;

    return (
        <div className="page page-season">
            <header className="page-head">
                <div>
                    <h1 className="page-title">
                        Season {onChainSeason !== undefined ? onChainSeason.toString() : '…'}{' '}
                        {left !== undefined && (ended ? <Pill tone="gold">Ended · awaiting close</Pill> : <Pill tone="green" pulse>Live</Pill>)}
                    </h1>
                    <p className="page-sub">20% of every play fee and 5% of every race pot feed the prize pool. At the end of the season it is shared between the top 10 players and the top 10 creators.</p>
                </div>
                <dl className="inline-stats">
                    <div>
                        <dt>Prize pool</dt>
                        <dd>{season.pool !== undefined ? <TokenAmount value={Number(formatEther(pool))} size="lg" /> : '—'}</dd>
                    </div>
                    <div>
                        <dt>
                            <CalendarClock size={13} aria-hidden /> Ends in
                        </dt>
                        <dd className={cx('season-countdown', ended && 'is-over')} data-testid="season-countdown">
                            {left !== undefined ? formatCountdown(left) : '—'}
                        </dd>
                    </div>
                    <div>
                        <dt>Scorers</dt>
                        <dd>{data ? `${data.players.length} · ${data.creators.length}` : '—'}</dd>
                    </div>
                </dl>
            </header>

            {standingsQ.error && !data && (
                <EmptyState tone="error" title="The standings could not be loaded" action={<Button icon={<RefreshCw size={15} aria-hidden />} onClick={() => void standingsQ.refetch()}>Retry</Button>}>
                    {(standingsQ.error as Error).message}
                </EmptyState>
            )}

            <div className="season-grid">
                <Card>
                    <CardHeader icon={<Trophy size={18} />} title="Players" aside={<Badge tone="neutral">{Math.min(data?.players.length ?? 0, maxWinners)} / {maxWinners} paid</Badge>} />
                    {!data ? <Skeleton w="100%" h={120} /> : <StandingsTable kind="players" rows={data.players} pool={pool} maxWinners={maxWinners} you={web3.address} />}
                </Card>
                <Card>
                    <CardHeader icon={<Crown size={18} />} title="Creators" aside={<Badge tone="neutral">{Math.min(data?.creators.length ?? 0, maxWinners)} / {maxWinners} paid</Badge>} />
                    {!data ? <Skeleton w="100%" h={120} /> : <StandingsTable kind="creators" rows={data.creators} pool={pool} maxWinners={maxWinners} you={web3.address} />}
                </Card>
            </div>

            {result && (
                <Card>
                    <CardHeader icon={<CheckCircle2 size={18} />} title={`Season ${result.season.toString()} payouts`} aside={<TokenAmount value={Number(formatEther(result.pool))} size="sm" />} />
                    <PayoutsTable payouts={result.payouts} pool={result.pool} />
                </Card>
            )}

            {web3.address && season.isAdmin && (
                <Card>
                    <CardHeader icon={<ShieldCheck size={18} />} title="Admin: close the season" aside={<ForgeCoin size={18} />} />
                    <ol className="season-steps">
                        <li className={cx('season-step', step > 1 ? 'is-done' : 'is-active')}>
                            <span className="season-step-n">1</span>
                            <div>
                                <h3>Fetch the signed result</h3>
                                <p className="fine">The server signs the ranking it computed itself (EIP-712 SeasonResult). It never signs a ranking sent by a caller.</p>
                                {proof && (
                                    <dl className="season-proof" aria-label="Signed season result">
                                        <dt>Season</dt>
                                        <dd>{proof.season}</dd>
                                        <dt>Players</dt>
                                        <dd>{np === 0 ? 'none' : proof.signed.shares.slice(0, np).map(bpsToPct).join(' · ')}</dd>
                                        <dt>Creators</dt>
                                        <dd>{nc === 0 ? 'none' : proof.signed.shares.slice(np).map(bpsToPct).join(' · ')}</dd>
                                        <dt>Signer</dt>
                                        <dd>{proof.signer}</dd>
                                    </dl>
                                )}
                                {proof && !proofMatches && <p className="season-warn">This proof is for season {proof.season}, but the contract is at season {onChainSeason?.toString()}. Fetch it again.</p>}
                                {proof && np + nc === 0 && <p className="season-warn">Nobody scored: closing pays nothing and the pool rolls over.</p>}
                                {proofError && <p className="season-warn">{proofError}</p>}
                                <Button icon={<FileSignature size={16} aria-hidden />} loading={fetchingProof} onClick={() => void fetchProof()}>
                                    {proof ? 'Fetch again' : 'Fetch signed result'}
                                </Button>
                            </div>
                        </li>
                        <li className={cx('season-step', step === 2 && 'is-active', step > 2 && 'is-done')}>
                            <span className="season-step-n">2</span>
                            <div>
                                <h3>Submit closeSeason from the admin wallet</h3>
                                <p className="fine">
                                    {ended
                                        ? `The season is over. Closing pays ${Number(formatEther(pool)).toLocaleString()} FORGE and starts season ${onChainSeason !== undefined ? (onChainSeason + 1n).toString() : '…'}.`
                                        : `The contract reverts with SeasonNotOver until the season end (${left !== undefined ? formatCountdown(left) : '…'}).`}
                                </p>
                                {!ended && isLocal && (
                                    <p className="fine">
                                        Local demo: run <code className="season-code">npm run season:ff</code> to move the chain clock to the season end.
                                    </p>
                                )}
                                <BlockerNotice compact />
                                <Button variant="primary" icon={<Hammer size={16} aria-hidden />} disabled={!ended || !proofMatches || !!web3.blocker} loading={tx.isBusy('close-season')} onClick={() => void closeSeason()}>
                                    Close season {onChainSeason?.toString()}
                                </Button>
                            </div>
                        </li>
                        <li className={cx('season-step', step === 3 && 'is-done')}>
                            <span className="season-step-n">3</span>
                            <div>
                                <h3>Payouts</h3>
                                <p className="fine">{result ? `Season ${result.season} paid ${result.payouts.length} winner${result.payouts.length === 1 ? '' : 's'}, see above.` : 'Read from the transaction receipt once the close is confirmed.'}</p>
                            </div>
                        </li>
                    </ol>
                </Card>
            )}

            <div className="season-grid">
                <Card>
                    <CardHeader icon={<Users size={18} />} title="How the ranking works" />
                    <ul className="plain-steps">
                        <li>Players: +1 point per level cleared (once per level) and +2 per level where they hold the best settled time.</li>
                        <li>Creators: +1 point per different player who paid to play one of their levels.</li>
                        <li>Playing your own level never scores. The pool is split 50% players, 50% creators, in proportion to the points; ties go to whoever reached the score first.</li>
                        <li>The server computes the ranking from public on-chain events and signs it; only the admin can submit it, after the season ends.</li>
                    </ul>
                    {data && (
                        <p className="fine">
                            This season: {data.totals.runs} paid runs, {data.totals.clears} clears, {data.totals.activePlayers} players on {data.totals.activeLevels} levels.
                        </p>
                    )}
                </Card>
                <Card>
                    <CardHeader icon={<History size={18} />} title="Past seasons" />
                    {!data ? <Skeleton w="100%" h={60} /> : <ClosedSeasonsList closed={data.closed} />}
                </Card>
            </div>
        </div>
    );
}
