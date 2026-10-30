import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { LevelCard } from '../components/ui';
import { useAsync } from '../components/useAsync';

export function HeroScenery() {
    return (
        <svg className="scenery" viewBox="0 0 600 200" preserveAspectRatio="xMaxYMax slice" aria-hidden>
            <rect x="60" y="150" width="140" height="50" rx="8" fill="#5cc94a" />
            <rect x="60" y="164" width="140" height="36" fill="#8b5a2b" />
            <rect x="250" y="120" width="90" height="22" rx="6" fill="#5cc94a" />
            <rect x="380" y="90" width="110" height="110" rx="8" fill="#8b5a2b" />
            <rect x="380" y="90" width="110" height="16" rx="6" fill="#5cc94a" />
            <circle cx="290" cy="80" r="11" fill="#ffc83d" />
            <circle cx="320" cy="64" r="11" fill="#ffc83d" />
            <circle cx="350" cy="80" r="11" fill="#ffc83d" />
            <ellipse cx="210" cy="78" rx="26" ry="28" fill="#4a7dff" />
            <ellipse cx="202" cy="72" rx="4" ry="7" fill="#10132a" />
            <ellipse cx="216" cy="72" rx="4" ry="7" fill="#10132a" />
            <rect x="460" y="30" width="4" height="60" fill="#e6e6e6" />
            <path d="M464 32 L500 44 L464 56 Z" fill="#7c5cff" />
        </svg>
    );
}

export default function Home() {
    const { data: levels } = useAsync(() => api.listLevels({ sort: 'popular' }), []);
    return (
        <div className="stack" style={{ gap: 24 }}>
            <section className="hero">
                <h1>Build. Publish. Earn.</h1>
                <p>Create worlds. Challenge players. Earn FORGE.</p>
                <div className="row">
                    <Link to="/editor" className="btn primary">
                        Create a level →
                    </Link>
                    <Link to="/browse" className="btn">
                        Browse levels
                    </Link>
                </div>
                <HeroScenery />
            </section>

            <section className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                {[
                    ['1', 'Build', 'Place terrain, hazards, seesaws and enemies on a 300×30 grid. Press T to test-play instantly.'],
                    ['2', 'Publish', 'Clear your own level, get a server-signed clear proof, pin to IPFS and mint a LevelNFT.'],
                    ['3', 'Earn', 'Players pay a FORGE fee per run: 70% to the level owner, 20% season pool, 10% treasury.'],
                ].map(([n, t, d]) => (
                    <div key={n} className="panel">
                        <div className="row">
                            <span className="badge">{n}</span>
                            <h3 style={{ margin: 0 }}>{t}</h3>
                        </div>
                        <p className="muted" style={{ marginBottom: 0 }}>
                            {d}
                        </p>
                    </div>
                ))}
            </section>

            <section className="stack">
                <div className="row between">
                    <h2>Trending levels</h2>
                    <Link to="/browse" className="btn sm ghost">
                        See all →
                    </Link>
                </div>
                <div className="grid-cards">{levels?.slice(0, 4).map((l) => <LevelCard key={l.id} level={l} />)}</div>
            </section>
        </div>
    );
}
