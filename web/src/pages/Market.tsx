import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { LevelThumb, compact, shortAddr } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { parseEther } from 'viem';
import { useMarket } from '../contracts/hooks';

type Sort = 'recent' | 'price-asc' | 'price-desc' | 'plays';

export default function Market() {
    const { data, loading } = useAsync(() => api.listListings(), []);
    const [sort, setSort] = useState<Sort>('recent');
    const market = useMarket();

    const rows = [...(data ?? [])].sort((a, b) => {
        if (sort === 'price-asc') return Number(a.priceEth) - Number(b.priceEth);
        if (sort === 'price-desc') return Number(b.priceEth) - Number(a.priceEth);
        if (sort === 'plays') return b.level.plays - a.level.plays;
        return 0;
    });
    const floor = rows.length ? Math.min(...rows.map((r) => Number(r.priceEth))) : 0;

    return (
        <div className="stack" style={{ gap: 18 }}>
            <div className="row between wrap">
                <div>
                    <h1 style={{ fontSize: 30 }}>Level market</h1>
                    <p className="muted" style={{ margin: '4px 0 0' }}>
                        Fixed-price LevelNFT listings. 5% royalty to the original creator on every sale (ERC-2981).
                    </p>
                </div>
                <div className="row">
                    <div className="panel" style={{ padding: '8px 14px' }}>
                        <span className="muted">Listed</span> <b>{rows.length}</b>
                    </div>
                    <div className="panel" style={{ padding: '8px 14px' }}>
                        <span className="muted">Floor</span> <b>{floor} ETH</b>
                    </div>
                    <select className="input" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                        <option value="recent">Recently listed</option>
                        <option value="price-asc">Price: low → high</option>
                        <option value="price-desc">Price: high → low</option>
                        <option value="plays">Most played</option>
                    </select>
                </div>
            </div>

            {loading && !data && <div className="empty">Loading listings…</div>}
            <div className="grid-cards">
                {rows.map((r) => (
                    <div key={r.level.id} className="card">
                        <Link to={`/level/${r.level.id}`}>
                            <LevelThumb theme={r.level.theme} seed={r.level.id} />
                        </Link>
                        <div className="card-body stack" style={{ gap: 8 }}>
                            <div className="row between">
                                <Link to={`/level/${r.level.id}`} className="card-title">
                                    #{r.level.id} {r.level.name}
                                </Link>
                                <span className="badge gray">{r.listedAgo}</span>
                            </div>
                            <div className="row between muted" style={{ fontSize: 13 }}>
                                <span>
                                    Seller <span className="mono">{shortAddr(r.seller)}</span>
                                </span>
                                <span>▶ {compact(r.level.plays)} plays</span>
                            </div>
                            <div className="row between">
                                <b style={{ fontSize: 18 }}>{r.priceEth} ETH</b>
                                <button
                                    className="btn primary sm"
                                    title="LevelNFT.buy(id)"
                                    onClick={() => void market.buy(BigInt(r.level.id), parseEther(r.priceEth)).catch((e) => console.warn('[buy]', e))}
                                >
                                    Buy
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
