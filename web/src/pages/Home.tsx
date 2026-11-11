import { ArrowRight, Coins, Gem, Hammer, Play, RefreshCw, Swords, Trophy } from 'lucide-react';
import { api } from '../api/client';
import { useMockData } from '../api/dataSource';
import { Hero } from '../components/Hero';
import { Avatar, Badge, Button, EmptyState, ForgeCoin, LevelGrid, compact } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { ShowcaseSection } from '../components/ShowcaseSection';

/** Fee split enforced by ForgeCoin.settleRun (SPEC §5.1). */
const SPLIT = [
    { label: 'Level owner', pct: 70, cls: 'split-owner' },
    { label: 'Season pool', pct: 20, cls: 'split-pool' },
    { label: 'Treasury', pct: 5, cls: 'split-treasury' },
    { label: 'Burned', pct: 5, cls: 'split-burn' },
];

export default function Home() {
    const popular = useAsync(() => api.listLevels({ sort: 'popular' }), []);
    const fresh = useAsync(() => api.listLevels({ sort: 'new' }), []);
    const mock = useMockData('/levels');
    const totalPlays = popular.data?.reduce((a, l) => a + l.plays, 0);

    return (
        <div className="page page-home">
            <Hero
                stats={
                    popular.data
                        ? [
                              { label: 'Levels published', value: String(popular.data.length) },
                              { label: 'Runs played', value: compact(totalPlays ?? 0) },
                              { label: 'Faucet', value: '100 FORGE' },
                          ]
                        : undefined
                }
            />

            <section className="section" aria-labelledby="trending-title">
                <header className="section-head">
                    <h2 id="trending-title" className="section-title">
                        Trending levels {mock && <Badge tone="neutral">Sample data</Badge>}
                    </h2>
                    <Button to="/browse?sort=popular" variant="ghost" size="sm" iconRight={<ArrowRight size={14} aria-hidden />}>
                        See all
                    </Button>
                </header>
                {popular.error && !popular.data ? (
                    <EmptyState tone="error" title="Levels could not be loaded" action={<Button icon={<RefreshCw size={15} aria-hidden />} onClick={popular.reload}>Retry</Button>}>
                        {popular.error.message}
                    </EmptyState>
                ) : (
                    <LevelGrid levels={popular.data?.slice(0, 4)} loading={popular.loading} count={4} />
                )}
            </section>

            <ShowcaseSection />

            <section className="section economy" aria-labelledby="economy-title">
                <div className="economy-copy">
                    <h2 id="economy-title" className="section-title">
                        Every run pays the builder
                    </h2>
                    <p className="lead">
                        Clear your own level, get a server-signed clear proof, pin it to IPFS and mint it as an ERC-721 LevelNFT. Each run a player settles pays your play fee in FORGE, split on-chain.
                    </p>
                    <ol className="economy-steps">
                        <li>
                            <Hammer size={18} aria-hidden />
                            <div>
                                <b>Build</b>
                                <span>37 elements: seesaws, pendulums, conveyors, springs, enemies. Press T to test-play.</span>
                            </div>
                        </li>
                        <li>
                            <Gem size={18} aria-hidden />
                            <div>
                                <b>Publish</b>
                                <span>Only <code>layoutHash</code> goes on-chain; the level JSON lives on IPFS.</span>
                            </div>
                        </li>
                        <li>
                            <Coins size={18} aria-hidden />
                            <div>
                                <b>Earn</b>
                                <span>Players pay your fee (max 100 FORGE) and earn a clear reward. NFT resales pay you a 5% royalty.</span>
                            </div>
                        </li>
                    </ol>
                </div>
                <figure className="split-card" aria-labelledby="split-caption">
                    <figcaption id="split-caption" className="split-head">
                        <span>Where a 5 FORGE play fee goes</span>
                        <span className="token-amount is-gold ta-lg">
                            <ForgeCoin size={22} /> <span className="num">5</span> <span className="sym">FORGE</span>
                        </span>
                    </figcaption>
                    <div className="split-bar" role="img" aria-label="70% to the level owner, 20% to the season pool, 5% to the treasury, 5% burned">
                        {SPLIT.map((s) => (
                            <span key={s.label} className={s.cls} style={{ flexBasis: `${s.pct}%` }} />
                        ))}
                    </div>
                    <dl className="split-legend">
                        {SPLIT.map((s) => (
                            <div key={s.label}>
                                <dt>
                                    <span className={`split-swatch ${s.cls}`} aria-hidden /> {s.label}
                                </dt>
                                <dd>
                                    {s.pct}% · <b>{((5 * s.pct) / 100).toFixed(1)} FORGE</b>
                                </dd>
                            </div>
                        ))}
                    </dl>
                </figure>
            </section>

            <section className="section race-band" aria-labelledby="race-title">
                <div className="race-band-racers" aria-hidden>
                    {['#7c5cff', '#22d3ee', '#ff5c7a', '#ffc83d'].map((c, i) => (
                        <Avatar key={c} color={c} size={52} style={{ transform: `translateY(${[0, -10, 4, -6][i]}px)` }} />
                    ))}
                </div>
                <div className="race-band-copy">
                    <h2 id="race-title" className="section-title">
                        Race for the pot
                    </h2>
                    <p>2 to 4 players stake FORGE on the same level. First to the flag takes 60%, second 25%; the level owner earns 10%.</p>
                </div>
                <div className="race-band-actions">
                    <Button to="/room/new" variant="primary" size="lg" icon={<Swords size={18} aria-hidden />}>
                        Open a race room
                    </Button>
                </div>
            </section>

            <section className="section" aria-labelledby="new-title">
                <header className="section-head">
                    <h2 id="new-title" className="section-title">
                        Freshly forged
                    </h2>
                    <div className="row">
                        <Button to="/market" variant="ghost" size="sm" icon={<Trophy size={14} aria-hidden />}>
                            Market
                        </Button>
                        <Button to="/browse?sort=new" variant="ghost" size="sm" icon={<Play size={14} aria-hidden />}>
                            All new levels
                        </Button>
                    </div>
                </header>
                <LevelGrid levels={fresh.data?.slice(0, 4)} loading={fresh.loading} count={4} />
            </section>
        </div>
    );
}
