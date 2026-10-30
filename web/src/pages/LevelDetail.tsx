import { Link, useParams } from 'react-router-dom';
import { useChainId } from 'wagmi';
import { formatEther } from 'viem';
import { api } from '../api/client';
import { LevelThumb, formatMs, shortAddr } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { useLevel, useMarket } from '../contracts/hooks';
import { formatForge } from '../contracts/hooks/useForgeBalance';
import { explorerTxUrl } from '../web3/config';

function EarningsChart({ points }: { points: { day: string; forge: number }[] }) {
    const W = 420;
    const H = 150;
    const max = Math.max(1200, ...points.map((p) => p.forge));
    const xy = points.map((p, i) => [30 + (i * (W - 40)) / Math.max(1, points.length - 1), H - 20 - (p.forge / max) * (H - 30)] as const);
    const line = xy.map(([x, y]) => `${x},${y}`).join(' ');
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Creator earnings, last 7 days">
            <defs>
                <linearGradient id="earn" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#7c5cff" stopOpacity=".55" />
                    <stop offset="1" stopColor="#7c5cff" stopOpacity="0" />
                </linearGradient>
            </defs>
            {[0, 400, 800, 1200].map((v) => {
                const y = H - 20 - (v / max) * (H - 30);
                return (
                    <g key={v}>
                        <line x1="30" x2={W - 10} y1={y} y2={y} stroke="#2a3354" />
                        <text x="0" y={y + 4} fill="#8f97bd" fontSize="10">
                            {v.toLocaleString()}
                        </text>
                    </g>
                );
            })}
            <polygon points={`${xy[0]?.[0]},${H - 20} ${line} ${xy[xy.length - 1]?.[0]},${H - 20}`} fill="url(#earn)" />
            <polyline points={line} fill="none" stroke="#9a82ff" strokeWidth="2.5" />
            {xy.map(([x, y], i) => (
                <g key={i}>
                    <circle cx={x} cy={y} r="3.5" fill="#fff" />
                    <text x={x} y={H - 4} fill="#8f97bd" fontSize="10" textAnchor="middle">
                        {points[i].day}
                    </text>
                </g>
            ))}
        </svg>
    );
}

export default function LevelDetail() {
    const id = Number(useParams().id);
    const chainId = useChainId();
    const { data: lvl, error } = useAsync(() => api.getLevel(id), [id]);
    const { data: board } = useAsync(() => api.getLeaderboard(id, 5), [id]);
    const { data: txs } = useAsync(() => api.getLevelActivity(id), [id]);
    const { data: earnings } = useAsync(() => api.getCreatorEarnings(id), [id]);
    const chain = useLevel(Number.isFinite(id) ? id : undefined);
    const market = useMarket();

    if (!Number.isFinite(id)) return <div className="empty">Invalid level id.</div>;
    if (error) return <div className="empty error">Could not load level #{id}: {error.message}</div>;
    if (!lvl) return <div className="empty">Loading level #{id}…</div>;

    // On-chain values win over indexer values when the contracts are configured.
    const plays = chain.level?.plays ?? lvl.plays;
    const clears = chain.level?.clears ?? lvl.clears;
    const best = chain.level?.bestTimeMs ?? lvl.bestTimeMs;
    const fee = chain.level ? formatForge(chain.level.playFee) : lvl.playFee;
    const owner = chain.level?.owner ?? lvl.owner;
    const creator = chain.level?.creator ?? lvl.creator;
    const listed = chain.listingPriceWei !== undefined ? (chain.listingPriceWei > 0n ? formatEther(chain.listingPriceWei) : null) : lvl.listedPriceEth;

    return (
        <div className="stack" style={{ gap: 16 }}>
            <div>
                <div className="breadcrumb">
                    <Link to="/browse">Browse</Link> / Level #{id}
                </div>
                <div className="row">
                    <h1 style={{ fontSize: 30 }}>
                        Level #{id} {lvl.name}
                    </h1>
                    <span className="badge">NFT · ERC-721</span>
                </div>
            </div>

            <div className="detail-grid">
                <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ position: 'relative' }}>
                        <LevelThumb theme={lvl.theme} seed={id} style={{ aspectRatio: '16 / 8' }} />
                        <Link to={`/play/${id}`} className="btn primary" style={{ position: 'absolute', left: 16, bottom: 16, padding: '12px 20px' }}>
                            ▶ Play level · {fee} FORGE
                        </Link>
                    </div>
                    <div className="stats">
                        <div>
                            <span className="muted">Plays</span>
                            <b>{plays.toLocaleString()}</b>
                        </div>
                        <div>
                            <span className="muted">Clears</span>
                            <b>{clears.toLocaleString()}</b>
                        </div>
                        <div>
                            <span className="muted">Best time</span>
                            <b className="mono">{formatMs(best || null)}</b>
                        </div>
                    </div>
                </div>

                <div className="stack">
                    <div className="panel">
                        <div className="row between" style={{ alignItems: 'flex-start' }}>
                            <div>
                                <h3>Ownership</h3>
                                <dl className="kv">
                                    <dt>Owner</dt>
                                    <dd className="mono">
                                        <Link to={`/profile/${owner}`}>{shortAddr(owner)}</Link>
                                    </dd>
                                    <dt>Creator</dt>
                                    <dd className="mono">
                                        <Link to={`/profile/${creator}`}>{shortAddr(creator)}</Link>
                                    </dd>
                                    <dt>Royalty</dt>
                                    <dd>{lvl.royaltyBps / 100}%</dd>
                                </dl>
                            </div>
                            <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
                                <button
                                    className="btn primary"
                                    disabled={!listed || !chain.listingPriceWei || market.phase === 'signing'}
                                    onClick={() => chain.listingPriceWei && void market.buy(BigInt(id), chain.listingPriceWei).catch((e) => console.warn('[buy]', e))}
                                    title="LevelNFT.buy(id) with value = listing price"
                                >
                                    {listed ? `Listed ${listed} ETH — Buy` : 'Not listed'}
                                </button>
                                <span className="muted" style={{ fontSize: 12 }}>
                                    {chainId === 11155111 ? 'Sepolia testnet' : 'Local hardhat'}
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="panel">
                        <div className="row between">
                            <h3 className="row" style={{ margin: 0 }}>
                                <span className="coin" /> Creator earned {Number(lvl.creatorEarned).toLocaleString()} FORGE
                            </h3>
                            <span className="muted" style={{ fontSize: 12 }}>
                                Last 7 days
                            </span>
                        </div>
                        {earnings && <EarningsChart points={earnings} />}
                    </div>
                </div>
            </div>

            <div className="detail-grid">
                <div className="panel">
                    <div className="row between">
                        <h3>🏆 On-chain leaderboard</h3>
                        <span className="muted" style={{ fontSize: 12 }}>
                            Top 5
                        </span>
                    </div>
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Rank</th>
                                <th>Player</th>
                                <th>Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {board?.map((r) => (
                                <tr key={r.rank}>
                                    <td>{r.rank <= 2 ? <span className="badge" style={r.rank === 1 ? { background: 'rgba(255,200,61,.2)', color: '#ffc83d', borderColor: '#ffc83d' } : undefined}>{r.rank}</span> : r.rank}</td>
                                    <td className="mono">
                                        <Link to={`/profile/${r.player}`}>{shortAddr(r.player)}</Link>
                                    </td>
                                    <td className="mono">{formatMs(r.timeMs)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="panel">
                    <h3>Recent transactions</h3>
                    <div className="stack" style={{ gap: 8 }}>
                        {txs?.map((t) => (
                            <div key={t.hash} className="row between" style={{ fontSize: 14 }}>
                                <span style={{ width: 110 }}>{t.kind}</span>
                                <a className="mono violet" href={explorerTxUrl(chainId, t.hash)} target="_blank" rel="noreferrer">
                                    {shortAddr(t.hash)}
                                </a>
                                <span className="row" style={{ gap: 6 }}>
                                    <span className="dot" /> {t.status}
                                </span>
                                <span className="muted">{t.ago}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
