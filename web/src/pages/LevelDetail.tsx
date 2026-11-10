import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatEther, parseEther, zeroAddress } from 'viem';
import { ArrowUpRight, ChevronRight, Clock, Flag, Gamepad2, GitFork, Heart, Pencil, Percent, Play, Receipt, RefreshCw, Tag, Trophy, UserRound } from 'lucide-react';
import { api } from '../api/client';
import { useMockData } from '../api/dataSource';
import { AddressChip, Badge, Button, Card, CardHeader, EmptyState, ExternalLink, ForgeCoin, LevelThumb, Pill, Skeleton, Stat, Tooltip, formatMs, shortAddr } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { useLevel, useMarket } from '../contracts/hooks';
import { formatForge } from '../contracts/hooks/useForgeBalance';
import { explorerTxUrl } from '../web3/config';
import { chainName, useTxFlow, useWeb3Status } from '../web3/tx';
import { BuyModal, ListModal } from '../components/MarketModals';
import { RemixLineage } from '../components/RemixLineage';

/** Single-series area chart: no legend, three faint gridlines, violet on the data. */
function EarningsChart({ points }: { points: { day: string; forge: number }[] }) {
    const W = 460;
    const H = 170;
    const top = Math.max(1, ...points.map((p) => p.forge));
    const max = Math.ceil(top / 400) * 400 || 400;
    const ticks = [0, max / 3, (2 * max) / 3, max].map((v) => Math.round(v));
    const x = (i: number) => 44 + (i * (W - 56)) / Math.max(1, points.length - 1);
    const y = (v: number) => H - 24 - (v / max) * (H - 40);
    const line = points.map((p, i) => `${x(i)},${y(p.forge)}`).join(' ');
    const total = points.reduce((a, p) => a + p.forge, 0);
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="chart" role="img" aria-label={`Creator earnings over the last ${points.length} days: ${total.toLocaleString()} FORGE in total, ${points.map((p) => `${p.day} ${p.forge}`).join(', ')}`}>
            {ticks.map((v) => (
                <g key={v}>
                    <line x1="44" x2={W - 8} y1={y(v)} y2={y(v)} className="chart-grid" />
                    <text x="36" y={y(v) + 4} className="chart-axis" textAnchor="end">
                        {v.toLocaleString()}
                    </text>
                </g>
            ))}
            {points.length > 1 && <polygon points={`${x(0)},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`} className="chart-area" />}
            <polyline points={line} className="chart-line" />
            {points.map((p, i) => (
                <g key={p.day}>
                    <circle cx={x(i)} cy={y(p.forge)} r="3.5" className="chart-dot" />
                    {(i % 2 === 0 || points.length <= 4) && (
                        <text x={x(i)} y={H - 6} className="chart-axis" textAnchor="middle">
                            {p.day}
                        </text>
                    )}
                </g>
            ))}
        </svg>
    );
}

function DetailSkeleton() {
    return (
        <div className="page" aria-busy="true" aria-label="Loading level">
            <Skeleton w={120} h={12} />
            <Skeleton w="40%" h={34} style={{ marginTop: 12 }} />
            <div className="detail-grid" style={{ marginTop: 20 }}>
                <Skeleton h={420} r={16} />
                <Skeleton h={420} r={16} />
            </div>
        </div>
    );
}

export default function LevelDetail() {
    const id = Number(useParams().id);
    const valid = Number.isInteger(id) && id > 0;
    const web3 = useWeb3Status();
    const { data: lvl, error, reload, loading } = useAsync(() => (valid ? api.getLevel(id) : Promise.reject(new Error('invalid'))), [id]);
    const board = useAsync(() => api.getLeaderboard(id, 5), [id]);
    const txs = useAsync(() => api.getLevelActivity(id), [id]);
    const earnings = useAsync(() => api.getCreatorEarnings(id), [id]);
    const chain = useLevel(valid ? id : undefined);
    const market = useMarket();
    const tx = useTxFlow();
    const mockDetail = useMockData('/levels/1');
    const mockActivity = useMockData('/levels/:id/activity');
    const mockEarnings = useMockData('/levels/:id/earnings');
    const [buying, setBuying] = useState(false);
    const [listing, setListing] = useState(false);

    if (!valid) return <EmptyState tone="error" title="Invalid level id" action={<Button to="/browse">Browse levels</Button>}>Level ids are positive integers, e.g. /level/42.</EmptyState>;
    if (error && !lvl) {
        return (
            <EmptyState tone="error" title={`Level #${id} could not be loaded`} action={<Button icon={<RefreshCw size={15} aria-hidden />} onClick={reload}>Retry</Button>}>
                {error.message}
            </EmptyState>
        );
    }
    if (!lvl || (loading && !lvl)) return <DetailSkeleton />;

    // On-chain values win over indexer values when the contracts answer. A zero creator means the token
    // does not exist on this chain (e.g. a stale indexer after a Hardhat restart): fall back to the indexer.
    const missingOnChain = Boolean(chain.level && chain.level.creator === zeroAddress);
    const onChain = Boolean(chain.level) && !missingOnChain;
    if (missingOnChain) chain.level = undefined;
    const plays = chain.level?.plays ?? lvl.plays;
    const clears = chain.level?.clears ?? lvl.clears;
    const best = chain.level?.bestTimeMs || lvl.bestTimeMs;
    const fee = chain.level ? formatForge(chain.level.playFee, 2) : lvl.playFee;
    const owner = chain.level?.owner ?? lvl.owner;
    const creator = chain.level?.creator ?? lvl.creator;
    const listingWei = chain.listingPriceWei !== undefined ? (chain.listingPriceWei > 0n ? chain.listingPriceWei : undefined) : lvl.listedPriceEth ? parseEther(lvl.listedPriceEth) : undefined;
    const listedEth = listingWei !== undefined ? formatEther(listingWei) : null;
    const isOwner = Boolean(web3.address && owner && web3.address.toLowerCase() === owner.toLowerCase());
    const sample = mockDetail && !onChain;
    // LevelNFT.publish reverts with ParentNotFound for a token that does not exist, and the copy needs the pinned JSON.
    const canRemix = !sample && !missingOnChain && Boolean(lvl.cid);

    const like = () => void tx.run('like', { title: `Like level #${id}`, success: 'Liked! Thanks for the support.' }, () => market.like(BigInt(id)));

    return (
        <div className="page page-detail">
            <nav className="breadcrumb" aria-label="Breadcrumb">
                <Link to="/browse">Browse</Link>
                <ChevronRight size={14} aria-hidden />
                <span aria-current="page">Level #{id}</span>
            </nav>
            <div className="title-row">
                <h1 className="page-title">
                    Level #{id} {lvl.name}
                </h1>
                <Badge tone="violet">
                    <b>NFT</b> ERC-721
                </Badge>
                {onChain ? (
                    <Pill tone="green">On-chain</Pill>
                ) : missingOnChain ? (
                    <Tooltip content="The indexer knows this level but the contract on this network does not (restarted chain?).">
                        <Badge tone="amber" tabIndex={0}>
                            Not found on this chain
                        </Badge>
                    </Tooltip>
                ) : sample ? (
                    <Badge tone="neutral">Sample data</Badge>
                ) : null}
                {lvl.parentId > 0 && (
                    <Link to={`/level/${lvl.parentId}`} className="fine-link">
                        Remix of #{lvl.parentId}
                    </Link>
                )}
                <Tooltip content={canRemix ? 'Open a copy in the editor. Change something, clear it and publish it as a child LevelNFT: the original creator shares its resale royalty.' : 'Remixing needs this level on-chain and its JSON on the game server.'}>
                    <span className="row-sm">
                        <Button to={canRemix ? `/editor?remix=${id}` : undefined} icon={<GitFork size={16} aria-hidden />} disabled={!canRemix}>
                            Remix
                        </Button>
                    </span>
                </Tooltip>
            </div>

            <div className="detail-grid">
                <Card pad={false} className="media-card">
                    <div className="media-stage">
                        <LevelThumb level={lvl} eager alt={`Screenshot of ${lvl.name}`} sizes="(max-width: 1100px) 100vw, 840px" />
                        <Button to={`/play/${id}`} variant="primary" size="lg" className="media-play" icon={<Play size={18} aria-hidden fill="currentColor" />}>
                            Play level · {fee} FORGE
                        </Button>
                    </div>
                    <div className="stat-row">
                        <Stat icon={<Gamepad2 size={22} />} label="Plays" value={plays.toLocaleString()} />
                        <Stat icon={<Flag size={22} />} label="Clears" value={clears.toLocaleString()} />
                        <Stat icon={<Clock size={22} />} label="Best time" value={<span className="num">{formatMs(best ?? null)}</span>} />
                    </div>
                </Card>

                <div className="stack-col">
                    <Card className="ownership-card">
                        <div className="ownership">
                            <div>
                                <CardHeader title="Ownership" />
                                <dl className="kv-icons">
                                    <div>
                                        <dt>
                                            <UserRound size={16} aria-hidden /> Owner
                                        </dt>
                                        <dd>
                                            <AddressChip address={owner} />
                                            {isOwner && <Badge tone="violet">You</Badge>}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>
                                            <Pencil size={16} aria-hidden /> Creator
                                        </dt>
                                        <dd>
                                            <AddressChip address={creator} />
                                        </dd>
                                    </div>
                                    <div>
                                        <dt>
                                            <Percent size={16} aria-hidden /> Royalty
                                        </dt>
                                        <dd>{lvl.royaltyBps / 100}%</dd>
                                    </div>
                                </dl>
                            </div>
                            <div className="ownership-cta">
                                {isOwner ? (
                                    <Button variant="primary" block icon={<Tag size={16} aria-hidden />} onClick={() => setListing(true)}>
                                        {listedEth ? `Listed ${listedEth} ETH · Edit` : 'List for sale'}
                                    </Button>
                                ) : listedEth ? (
                                    <Button variant="primary" block onClick={() => setBuying(true)}>
                                        Listed {listedEth} ETH — Buy
                                    </Button>
                                ) : (
                                    <Tooltip content="The owner has not listed this level for sale.">
                                        <Button block disabled>
                                            Not listed
                                        </Button>
                                    </Tooltip>
                                )}
                                <span className="fine">{chainName(web3.chainId)}{web3.chainId === 11155111 ? ' testnet' : ''}</span>
                            </div>
                        </div>
                    </Card>

                    <Card>
                        <CardHeader
                            icon={<ForgeCoin size={22} />}
                            title={<>Creator earned {Number(lvl.creatorEarned).toLocaleString()} FORGE</>}
                            aside={
                                <span className="row-sm">
                                    {mockEarnings && <Badge tone="neutral">Sample</Badge>}
                                    <span className="fine">Last 7 days</span>
                                </span>
                            }
                        />
                        {earnings.data && earnings.data.length > 0 ? (
                            <EarningsChart points={earnings.data} />
                        ) : earnings.loading ? (
                            <Skeleton h={170} />
                        ) : (
                            <EmptyState compact title="No earnings yet">Earnings appear after the first settled run.</EmptyState>
                        )}
                    </Card>
                </div>
            </div>

            <div className="detail-grid">
                <Card>
                    <CardHeader icon={<Trophy size={18} className="gold" />} title="On-chain leaderboard" aside={<span className="fine">Top 5</span>} />
                    {board.loading && !board.data ? (
                        <Skeleton h={180} />
                    ) : board.data && board.data.length ? (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th scope="col">Rank</th>
                                    <th scope="col">Player</th>
                                    <th scope="col" className="num-col">
                                        Time
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {board.data.map((r) => (
                                    <tr key={r.rank} className={web3.address?.toLowerCase() === r.player.toLowerCase() ? 'is-you' : undefined}>
                                        <td>
                                            <span className={`rank rank-${r.rank}`}>{r.rank}</span>
                                        </td>
                                        <td>
                                            <AddressChip address={r.player} avatar />
                                        </td>
                                        <td className="num-col num">{formatMs(r.timeMs)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <EmptyState compact icon={<Trophy size={22} />} title="No clears yet" action={<Button to={`/play/${id}`} variant="primary" size="sm">Be the first</Button>}>
                            Settle a clear on-chain to take rank #1.
                        </EmptyState>
                    )}
                </Card>
                <Card>
                    <CardHeader icon={<Receipt size={18} />} title="Recent transactions" aside={mockActivity ? <Badge tone="neutral">Sample</Badge> : undefined} />
                    {txs.data && txs.data.length ? (
                        <ul className="tx-list">
                            {txs.data.map((t) => {
                                const url = explorerTxUrl(web3.chainId, t.hash);
                                return (
                                    <li key={t.hash}>
                                        <span className="tx-kind">
                                            {t.kind === 'Play fee' ? <Play size={14} aria-hidden /> : t.kind === 'Listed' ? <Tag size={14} aria-hidden /> : <Trophy size={14} aria-hidden />} {t.kind}
                                        </span>
                                        <span className="tx-hash">{shortAddr(t.hash)}</span>
                                        <Pill tone={t.status === 'Confirmed' ? 'green' : t.status === 'Pending' ? 'amber' : 'red'}>{t.status}</Pill>
                                        <span className="fine">{t.ago}</span>
                                        {url.startsWith('http') ? (
                                            <ExternalLink href={url} aria-label={`Open transaction ${t.hash} in the explorer`} className="icon-btn icon-btn-xs">
                                                <ArrowUpRight size={14} />
                                            </ExternalLink>
                                        ) : (
                                            <span className="icon-btn icon-btn-xs is-disabled" title="No public explorer for the local chain" aria-hidden>
                                                <ArrowUpRight size={14} />
                                            </span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <EmptyState compact title="No activity yet" />
                    )}
                    <div className="card-foot">
                        {web3.chainId === 11155111 ? (
                            <ExternalLink href={`https://sepolia.etherscan.io/token/${owner}`}>
                                View on Etherscan <ArrowUpRight size={13} aria-hidden />
                            </ExternalLink>
                        ) : (
                            <span className="fine">Local Hardhat chain: no public explorer</span>
                        )}
                        <Button size="sm" variant="ghost" icon={<Heart size={14} aria-hidden />} disabled={!!web3.blocker || missingOnChain || tx.isBusy('like')} loading={tx.isBusy('like')} onClick={like} title={web3.blocker ? 'Connect a wallet on the right network to like' : 'LevelNFT.like(id)'}>
                            Like · {lvl.likes}
                        </Button>
                    </div>
                </Card>
            </div>

            <RemixLineage id={id} name={lvl.name} creator={creator} canRemix={canRemix} />

            <BuyModal open={buying} onClose={() => setBuying(false)} levelId={id} levelName={lvl.name} priceWei={listingWei} seller={owner} creator={creator} onDone={() => void chain.refetch()} />
            <ListModal open={listing} onClose={() => setListing(false)} levelId={id} levelName={lvl.name} currentWei={listingWei} onDone={() => void chain.refetch()} />
        </div>
    );
}
