import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Hammer, Swords } from 'lucide-react';
import { Button, cx } from './ui';
import type { Theme } from '../game/level/types';

/** Hero banner over a real 1:1 render of a RealmForge level (captured from the Phaser editor). */
export function Hero({ compact, theme = 'grass', stats }: { compact?: boolean; theme?: Theme; stats?: { label: string; value: string }[] }) {
    return (
        <section className={cx('hero', compact && 'hero-compact')} aria-labelledby="hero-title">
            <img className="hero-art" src={`/ui/hero/${theme}.webp`} alt="" width={1920} height={445} fetchPriority="high" decoding="async" />
            <div className="hero-scrim" aria-hidden />
            <div className="hero-copy">
                <h1 id="hero-title" className="hero-title">
                    Build. Publish. Earn.
                </h1>
                <p className="hero-sub">Create worlds. Challenge players. Earn FORGE.</p>
                <div className="hero-actions">
                    <Button to="/editor" variant="primary" size="lg" icon={<Hammer size={18} aria-hidden />} iconRight={<ArrowRight size={16} aria-hidden />}>
                        Create a level
                    </Button>
                    {!compact && (
                        <Button to="/browse" size="lg" icon={<Compass size={18} aria-hidden />}>
                            Browse levels
                        </Button>
                    )}
                    {!compact && (
                        <Link to="/room/new" className="hero-link">
                            <Swords size={16} aria-hidden /> Start a versus race
                        </Link>
                    )}
                </div>
                {stats && (
                    <dl className="hero-stats">
                        {stats.map((s) => (
                            <div key={s.label}>
                                <dt>{s.label}</dt>
                                <dd>{s.value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </div>
        </section>
    );
}
