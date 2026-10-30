import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { LevelSort } from '../api/types';
import { LevelCard } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { THEMES } from '../game/level/types';
import { HeroScenery } from './Home';

const SORTS: { id: LevelSort; label: string }[] = [
    { id: 'new', label: 'New' },
    { id: 'popular', label: 'Popular' },
    { id: 'hardest', label: 'Hardest' },
];

export default function Browse() {
    const [params, setParams] = useSearchParams();
    const sort = (params.get('sort') as LevelSort) || 'new';
    const theme = params.get('theme') || 'all';
    const search = params.get('q') || '';
    const creator = params.get('creator') || '';

    const set = (k: string, v: string) => {
        const next = new URLSearchParams(params);
        if (v && v !== 'all') next.set(k, v);
        else next.delete(k);
        setParams(next, { replace: true });
    };

    const { data, loading, error } = useAsync(() => api.listLevels({ sort, theme, search, creator }), [sort, theme, search, creator]);

    return (
        <div>
            <section className="hero">
                <h1>Build. Publish. Earn.</h1>
                <p>Create worlds. Challenge players. Earn FORGE.</p>
                <Link to="/editor" className="btn primary">
                    Create a level →
                </Link>
                <HeroScenery />
            </section>

            <div className="row between wrap" style={{ marginBottom: 16 }}>
                <div className="row">
                    <h2 style={{ marginRight: 12 }}>Explore levels</h2>
                    <div className="tabs">
                        {SORTS.map((s) => (
                            <button key={s.id} className={`tab ${sort === s.id ? 'active' : ''}`} onClick={() => set('sort', s.id)}>
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="row">
                    <input className="input" style={{ width: 240 }} placeholder="🔍  Search levels" value={search} onChange={(e) => set('q', e.target.value)} />
                    <input className="input mono" style={{ width: 170 }} placeholder="Creator 0x…" value={creator} onChange={(e) => set('creator', e.target.value)} />
                    <select className="input" style={{ width: 140 }} value={theme} onChange={(e) => set('theme', e.target.value)}>
                        <option value="all">All themes</option>
                        {THEMES.map((t) => (
                            <option key={t} value={t}>
                                {t[0].toUpperCase() + t.slice(1)}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {error && <p className="error">Failed to load levels: {error.message}</p>}
            {loading && !data && <div className="empty">Loading levels…</div>}
            {data && data.length === 0 && <div className="empty">No levels match these filters.</div>}
            <div className="grid-cards">{data?.map((l) => <LevelCard key={l.id} level={l} />)}</div>
        </div>
    );
}
