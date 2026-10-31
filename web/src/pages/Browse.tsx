import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FilterX, RefreshCw, Search, SearchX, User } from 'lucide-react';
import { isAddress } from 'viem';
import { api } from '../api/client';
import type { LevelSort } from '../api/types';
import { useMockData } from '../api/dataSource';
import { Hero } from '../components/Hero';
import { Badge, Button, EmptyState, Input, LevelGrid, Select, Tabs, capitalize } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { THEMES } from '../game/level/types';

const SORTS: { id: LevelSort; label: string }[] = [
    { id: 'new', label: 'New' },
    { id: 'popular', label: 'Popular' },
    { id: 'hardest', label: 'Hardest' },
];

/** Debounce a text value so typing does not refetch on every key. */
function useDebounced<T>(value: T, ms = 250) {
    const [v, setV] = useState(value);
    useEffect(() => {
        const t = setTimeout(() => setV(value), ms);
        return () => clearTimeout(t);
    }, [value, ms]);
    return v;
}

export default function Browse() {
    const [params, setParams] = useSearchParams();
    const sort = (params.get('sort') as LevelSort) || 'new';
    const theme = params.get('theme') || 'all';
    const [search, setSearch] = useState(params.get('q') || '');
    const [creator, setCreator] = useState(params.get('creator') || '');
    const q = useDebounced(search);
    const c = useDebounced(creator);
    const creatorInvalid = c !== '' && !isAddress(c);

    const set = (k: string, v: string) => {
        const next = new URLSearchParams(params);
        if (v && v !== 'all') next.set(k, v);
        else next.delete(k);
        setParams(next, { replace: true });
    };
    useEffect(() => set('q', q), [q]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => set('creator', c), [c]); // eslint-disable-line react-hooks/exhaustive-deps

    const { data, loading, error, reload } = useAsync(() => api.listLevels({ sort, theme, search: q, creator: creatorInvalid ? '' : c }), [sort, theme, q, c, creatorInvalid]);
    const mock = useMockData('/levels');
    const shown = creatorInvalid || !c ? data : data?.filter((l) => l.creator.toLowerCase() === c.toLowerCase());
    const filtered = q !== '' || theme !== 'all' || c !== '';

    const clear = () => {
        setSearch('');
        setCreator('');
        setParams(sort === 'new' ? {} : { sort }, { replace: true });
    };

    return (
        <div className="page page-browse">
            <Hero compact theme="snow" />

            <section className="section section-tight" aria-labelledby="explore-title">
                <div className="toolbar-row">
                    <div className="toolbar-group">
                        <h2 id="explore-title" className="section-title">
                            Explore levels
                        </h2>
                        <Tabs label="Sort levels" items={SORTS} value={sort} onChange={(v) => set('sort', v)} idBase="browse" />
                    </div>
                    <div className="toolbar-group filters">
                        <Input icon={<Search size={16} />} type="search" placeholder="Search levels" aria-label="Search levels by name" value={search} onChange={(e) => setSearch(e.target.value)} className="w-search" />
                        <Input icon={<User size={16} />} placeholder="Creator 0x…" aria-label="Filter by creator address" aria-invalid={creatorInvalid} value={creator} onChange={(e) => setCreator(e.target.value.trim())} className="w-creator" />
                        <Select aria-label="Theme" value={theme} onChange={(e) => set('theme', e.target.value)} className="w-theme">
                            <option value="all">All themes</option>
                            {THEMES.map((t) => (
                                <option key={t} value={t}>
                                    {capitalize(t)}
                                </option>
                            ))}
                        </Select>
                    </div>
                </div>
                <div className="results-line" aria-live="polite">
                    {loading && !data ? 'Loading levels…' : shown ? `${shown.length} level${shown.length === 1 ? '' : 's'}` : ''}
                    {creatorInvalid && <span className="field-error"> · “{c}” is not a valid address</span>}
                    {mock && <Badge tone="neutral">Sample data · API offline</Badge>}
                    {filtered && (
                        <Button size="sm" variant="ghost" icon={<FilterX size={14} aria-hidden />} onClick={clear}>
                            Clear filters
                        </Button>
                    )}
                </div>

                <div id="browse-panel" role="tabpanel" aria-labelledby={`browse-tab-${sort}`}>
                    {error && !data ? (
                        <EmptyState tone="error" title="Levels could not be loaded" action={<Button icon={<RefreshCw size={15} aria-hidden />} onClick={reload}>Retry</Button>}>
                            {error.message}
                        </EmptyState>
                    ) : shown && shown.length === 0 ? (
                        <EmptyState icon={<SearchX size={26} />} title="No levels match these filters" action={<Button icon={<FilterX size={15} aria-hidden />} onClick={clear}>Clear filters</Button>}>
                            Try another theme or search term, or build the level you were looking for.
                        </EmptyState>
                    ) : (
                        <LevelGrid levels={shown} loading={loading} />
                    )}
                </div>
            </section>
        </div>
    );
}
