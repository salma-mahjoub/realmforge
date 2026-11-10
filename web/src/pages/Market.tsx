import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatEther, parseEther } from 'viem';
import { Gavel, Play, RefreshCw, ShoppingCart, Store, Tag } from 'lucide-react';
import { api } from '../api/client';
import type { Listing } from '../api/types';
import { useMockData } from '../api/dataSource';
import { AddressChip, Badge, Button, EmptyState, LevelCardSkeleton, LevelThumb, Select, TokenAmount, compact } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { BuyModal, ListModal } from '../components/MarketModals';
import { useWeb3Status } from '../web3/tx';
import { useAuction } from '../contracts/hooks';
import { useTxFlow } from '../web3/tx';
import { Tabs } from '../components/ui';

type Sort = 'recent' | 'price-asc' | 'price-desc' | 'plays';

export default function Market() {
    const { data, loading, error, reload } = useAsync(() => api.listListings(), []);
    const [sort, setSort] = useState<Sort>('recent');
    const [buying, setBuying] = useState<Listing | null>(null);
    const [managing, setManaging] = useState<Listing | null>(null);
    const [tab, setTab] = useState<'fixed' | 'auctions'>('fixed');
    const [auctions, setAuctions] = useState<{ levelId: number; seller: `0x${string}`; reservePrice: string; highestBid: string | null; highestBidder: `0x${string}` | null; endTime: number }[]>([]);
    const mock = useMockData('/market/listings');
    const web3 = useWeb3Status();
    const auction = useAuction();
    const tx = useTxFlow();
    const refreshAuctions = () => void api.listAuctions().then((r) => setAuctions(r.items)).catch(() => setAuctions([]));
    useEffect(() => { refreshAuctions(); const timer = window.setInterval(refreshAuctions, 5_000); return () => window.clearInterval(timer); }, []);

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

            <Tabs label="Market type" value={tab} onChange={setTab} items={[{ id: 'fixed', label: 'Fixed price' }, { id: 'auctions', label: 'Auctions', icon: <Gavel size={14} /> }]} />
            {tab === 'auctions' ? <div className="level-grid">{auctions.length === 0 ? <EmptyState icon={<Gavel size={26} />} title="No active auctions">Owners can start an auction from a level page.</EmptyState> : auctions.map((a) => <article className="market-card" key={a.levelId}><div className="level-card-body"><h2 className="level-card-title"><Link to={`/level/${a.levelId}`}>Level #{a.levelId}</Link></h2><p>Reserve {formatEther(BigInt(a.reservePrice))} ETH</p><p>Highest bid {a.highestBid ? `${formatEther(BigInt(a.highestBid))} ETH` : 'No bids'}</p><p>Ends {new Date(a.endTime * 1000).toLocaleString()}</p><AuctionActions item={a} auction={auction} tx={tx} reload={refreshAuctions} /></div></article>)}</div> : <>

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
            </>}
        </div>
    );
}

function AuctionActions({ item, auction, tx, reload }: { item: { levelId: number; endTime: number; highestBid?: string | null }; auction: ReturnType<typeof useAuction>; tx: ReturnType<typeof useTxFlow>; reload: () => void }) {
    const [amount, setAmount] = useState('0.01');
    const [now, setNow] = useState(Date.now());
    useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
    const remaining = Math.max(0, Math.ceil(item.endTime - now / 1000));
    const countdown = `${Math.floor(remaining / 3600)}:${String(Math.floor((remaining % 3600) / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
    return <div className="row-sm"><span>Time left {countdown}</span><input aria-label="Bid amount ETH" value={amount} onChange={(e) => setAmount(e.target.value)} /><Button size="sm" onClick={() => void tx.run('auction bid', { title: `Bid on level #${item.levelId}`, success: 'Bid placed' }, () => auction.bid(BigInt(item.levelId), amount)).then(reload)}>Bid</Button>{remaining === 0 && <Button size="sm" variant="primary" onClick={() => void tx.run('auction settle', { title: `Settle level #${item.levelId}`, success: 'Auction settled' }, () => auction.settle(BigInt(item.levelId))).then(reload)}>Settle</Button>}<Button size="sm" onClick={() => void tx.run('auction withdraw', { title: 'Withdraw auction proceeds', success: 'Withdrawal complete' }, () => auction.withdraw())}>Withdraw</Button></div>;
}
