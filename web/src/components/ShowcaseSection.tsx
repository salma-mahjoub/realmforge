import { useNavigate } from 'react-router-dom';
import { Pencil, Play } from 'lucide-react';
import { SAMPLE_LEVEL, loadAutosave, saveAutosave } from '../game/level';
import { layoutHash } from '../game/level/serialize';
import { SHOWCASE, type ShowcaseLevel } from '../game/level/showcase';
import { Badge, Button, toast } from './ui';
import { thumbFor } from './LevelCard';

/** Puts a showcase level in the editor draft, asking first when the draft holds real work. */
export function openShowcase(level: ShowcaseLevel, navigate: (to: string) => void, play: boolean) {
    const draft = loadAutosave();
    const file = level.file();
    const isScratch = !draft || layoutHash(draft) === layoutHash(SAMPLE_LEVEL) || layoutHash(draft) === layoutHash(file);
    if (!isScratch && !window.confirm(`Replace your editor draft "${draft?.meta.name ?? 'Untitled'}" with ${level.name}? Your draft is not published.`)) return;
    saveAutosave(file);
    navigate(play ? '/editor?play=1' : '/editor');
    if (!play) toast.info(`${level.name} is in the editor`, 'Change it, clear it with T, then publish it as your own NFT.');
}

function ShowcaseCard({ level }: { level: ShowcaseLevel }) {
    const navigate = useNavigate();
    return (
        <article className="showcase-card">
            <div className="showcase-thumb">
                <img
                    src={level.preview}
                    alt={`${level.name} preview`}
                    loading="lazy"
                    width={640}
                    height={360}
                    onError={(e) => {
                        const img = e.currentTarget;
                        const fallback = thumbFor({ id: level.id.length, theme: level.theme });
                        if (!img.src.endsWith(fallback)) img.src = fallback;
                    }}
                />
                <span className="showcase-tags">
                    {level.tags.map((t) => (
                        <Badge key={t} tone={t === 'Hard' ? 'red' : t === 'Template' ? 'neutral' : 'violet'}>
                            {t}
                        </Badge>
                    ))}
                </span>
            </div>
            <div className="showcase-body">
                <h3>{level.name}</h3>
                <p>{level.blurb}</p>
                <div className="showcase-actions">
                    <Button size="sm" variant="primary" icon={<Play size={14} aria-hidden fill="currentColor" />} onClick={() => openShowcase(level, navigate, true)}>
                        Play
                    </Button>
                    <Button size="sm" icon={<Pencil size={14} aria-hidden />} onClick={() => openShowcase(level, navigate, false)}>
                        Remix in editor
                    </Button>
                </div>
            </div>
        </article>
    );
}

/** "Made by us": the levels the RealmForge team built, bundled with the app (no wallet or chain needed). */
export function ShowcaseSection() {
    return (
        <section className="section" aria-labelledby="showcase-title">
            <header className="section-head">
                <div>
                    <h2 id="showcase-title" className="section-title">
                        Made by us
                    </h2>
                    <p className="section-sub">Levels we built while making RealmForge. Play them free, or remix one and publish it as your own NFT.</p>
                </div>
            </header>
            <div className="showcase-grid">
                {SHOWCASE.map((l) => (
                    <ShowcaseCard key={l.id} level={l} />
                ))}
            </div>
        </section>
    );
}
