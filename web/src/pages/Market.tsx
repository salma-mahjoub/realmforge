import { useState } from 'react';
import { Link } from 'react-router-dom';
import { parseEther } from 'viem';
import { Play, RefreshCw, ShoppingCart, Store, Tag } from 'lucide-react';
import { api } from '../api/client';
import type { Listing } from '../api/types';
import { useMockData } from '../api/dataSource';
import { AddressChip, Badge, Button, EmptyState, LevelCardSkeleton, LevelThumb, Select, TokenAmount, compact } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { BuyModal, ListModal } from '../components/MarketModals';
import { useWeb3Status } from '../web3/tx';

type Sort = 'recent' | 'price-asc' | 'price-desc' | 'plays';

export default function Market() {
    const { data, loading, error, reload } = useAsync(() => api.listListings(), []);
    const [sort, setSort] = useState<Sort>('recent');
    const [buying, setBuying] = useState<Listing | null>(null);
    const [managing, setManaging] = useState<Listing | null>(null);
    const mock = useMockData('/market/listings');
    const web3 = useWeb3Status();

    const rows = [...(data ?? [])].sort((a, b) => {
        if (sort === 'price-asc') return Number(a.priceEth) - Number(b.priceEth);
        if (sort === 'price-desc') return Number(b.priceEth) - Number(a.priceEth);
        if (sort === 'plays') return b.level.plays - a.level.plays;
        return 0;
    });
    const floor = rows.length ? Math.min(...rows.map((r) => Number(r.priceEth))) : null;
    const plays = rows.reduce((a, r) => a + r.level.plays, 0);

    return (
        <div className="page page-market">
            <header className="page-head">
                <div>
                    <h1 className="page-title">
                        Level market {mock && <Badge tone="neutral">Sample data</Badge>}
                    </h1>
                    <p className="page-sub">Fixed-price LevelNFT listings, paid in ETH. Every sale pays the original creator a 5% royalty (ERC-2981).</p>
                </div>
                <dl className="inline-stats">
                    <div>
                        <dt>Listed</dt>
                        <dd>{data ? rows.length : '—'}</dd>
                    </div>
                    <div>
                        <dt>Floor</dt>
                        <dd>{floor != null ? `${floor} ETH` : '—'}</dd>
                    </div>
                    <div>
                        <dt>Plays on listed levels</dt>
                        <dd>{data ? compact(plays) : '—'}</dd>
                    </div>
                </dl>
            </header>

            <div className="toolbar-row">
                <span className="results-line">{data ? `${rows.length} listing${rows.length === 1 ? '' : 's'}` : 'Loading listings…'}</span>
                <Select aria-label="Sort listings" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-sort">
                    <option value="recent">Recently listed</option>
                    <option value="price-asc">Price: low to high</option>
                    <option value="price-desc">Price: high to low</option>
                    <option value="plays">Most played</option>
                </Select>
            </div>

            {error && !data ? (
                <EmptyState tone="error" title="Listings could not be loaded" action={<Button icon={<RefreshCw size={15} aria-hidden />} onClick={reload}>Retry</Button>}>
                    {error.message}
                </EmptyState>
            ) : loading && !data ? (
                <div className="level-grid" aria-busy="true">
                    {Array.from({ length: 4 }, (_, i) => (
                        <LevelCardSkeleton key={i} />
                    ))}
                </div>
            ) : rows.length === 0 ? (
                <EmptyState icon={<Store size={26} />} title="Nothing for sale right now" action={<Button to="/browse">Browse levels</Button>}>
                    Owners list levels from the level page. Check back soon or publish your own.
                </EmptyState>
            ) : (
                <div className="level-grid">
                    {rows.map((r) => {
                        const mine = web3.address?.toLowerCase() === r.seller.toLowerCase();
                        return (
                            <article key={r.level.id} className="market-card">
                                <Link to={`/level/${r.level.id}`} className="market-card-media" aria-label={`Open level #${r.level.id} ${r.level.name}`}>
                                    <LevelThumb level={r.level} />
                                    <span className="level-card-flag">
                                        <Tag size={12} aria-hidden /> {r.listedAgo}
                                    </span>
                                </Link>
                                <div className="level-card-body">
                                    <div className="level-card-row">
                                        <h2 className="level-card-title">
                                            <Link to={`/level/${r.level.id}`}>
                                                #{r.level.id} {r.level.name}
                                            </Link>
                                        </h2>
                                    </div>
                                    <div className="market-meta">
                                        <span>
                                            Seller <AddressChip address={r.seller} copy={false} />
                                        </span>
                                        <span>
                                            <Play size={13} aria-hidden /> {compact(r.level.plays)}
                                        </span>
                                    </div>
                                    <div className="market-buy">
                                        <TokenAmount value={r.priceEth} symbol="ETH" size="lg" maxFrac={6} />
                                        {mine ? (
                                            <Button size="sm" onClick={() => setManaging(r)} icon={<Tag size={14} aria-hidden />}>
                                                Manage
                                            </Button>
                                        ) : (
                                            <Button size="sm" variant="primary" onClick={() => setBuying(r)} icon={<ShoppingCart size={14} aria-hidden />} aria-label={`Buy level #${r.level.id} for ${r.priceEth} ETH`}>
                                                Buy
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}

            {buying && (
                <BuyModal open onClose={() => setBuying(null)} levelId={buying.level.id} levelName={buying.level.name} priceWei={parseEther(buying.priceEth)} seller={buying.seller} creator={buying.level.creator} onDone={reload} sample={mock} />
            )}
            {managing && <ListModal open onClose={() => setManaging(null)} levelId={managing.level.id} levelName={managing.level.name} currentWei={parseEther(managing.priceEth)} onDone={reload} />}
        </div>
    );
}
