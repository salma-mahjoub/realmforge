import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Play, Tag, Trophy } from 'lucide-react';
import type { LevelSummary } from '../api/types';
import type { Theme } from '../game/level/types';
import { compact, pct, shortAddr } from './ui/format';
import { ForgeCoin } from './ui/web3';
import { Skeleton, cx } from './ui/primitives';

const THEME_FALLBACK: Record<Theme, string> = { grass: '#3f8de0', desert: '#e7b26a', snow: '#9cb8ef', castle: '#3a1d2b' };

/**
 * Real in-game render of the level's theme (captured from the Phaser editor at 1:1, public/ui/thumbs)
 * unless the indexer has the pinned IPFS thumbnail produced by `game.renderer.snapshot` at publish.
 */
export function thumbFor(level: { id: number; theme: Theme }) {
    return `/ui/thumbs/${level.theme}-${Math.abs(level.id) % 4}.webp`;
}

export function LevelThumb({ level, className, eager, alt = '', sizes = '(max-width: 640px) 100vw, 340px' }: { level: Pick<LevelSummary, 'id' | 'theme' | 'thumbnailUrl'>; className?: string; eager?: boolean; alt?: string; sizes?: string }) {
    const local = thumbFor(level);
    const [src, setSrc] = useState(level.thumbnailUrl || local);
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    return (
        <div className={cx('thumb', loaded && 'is-loaded', className)} style={{ background: THEME_FALLBACK[level.theme] }}>
            {!failed && (
                <img
                    src={src}
                    srcSet={src === local ? `${local} 640w, ${local.replace('.webp', '@2x.webp')} 1280w` : undefined}
                    sizes={sizes}
                    alt={alt}
                    width={640}
                    height={360}
                    loading={eager ? 'eager' : 'lazy'}
                    decoding="async"
                    onLoad={() => setLoaded(true)}
                    onError={() => (src !== local ? setSrc(local) : setFailed(true))}
                />
            )}
        </div>
    );
}

export function LevelCard({ level, rank }: { level: LevelSummary; rank?: number }) {
    return (
        <Link to={`/level/${level.id}`} className="level-card" aria-label={`${level.name}, play fee ${level.playFee} FORGE, ${level.plays} plays, ${pct(level.clearRate)} clear rate`}>
            <div className="level-card-media">
                <LevelThumb level={level} />
                {level.listedPriceEth && (
                    <span className="level-card-flag">
                        <Tag size={12} aria-hidden /> {level.listedPriceEth} ETH
                    </span>
                )}
                {rank != null && <span className="level-card-rank">#{rank}</span>}
            </div>
            <div className="level-card-body">
                <div className="level-card-row">
                    <h3 className="level-card-title">{level.name}</h3>
                    <span className="level-card-fee">
                        <ForgeCoin size={15} /> {level.playFee} FORGE
                    </span>
                </div>
                <div className="level-card-creator">{shortAddr(level.creator)}</div>
                <div className="level-card-meta">
                    <span title="Plays">
                        <Play size={13} aria-hidden /> {compact(level.plays)} plays
                    </span>
                    <span title="Clear rate">
                        <Trophy size={13} aria-hidden /> {pct(level.clearRate)} clear
                    </span>
                    <span title="Likes">
                        <Heart size={13} aria-hidden /> {compact(level.likes)}
                    </span>
                </div>
            </div>
        </Link>
    );
}

export function LevelCardSkeleton() {
    return (
        <div className="level-card is-skeleton" aria-hidden>
            <div className="level-card-media">
                <div className="thumb">
                    <Skeleton w="100%" h="100%" r={0} />
                </div>
            </div>
            <div className="level-card-body">
                <div className="level-card-row">
                    <Skeleton w="55%" h={16} />
                    <Skeleton w={60} h={14} />
                </div>
                <Skeleton w={90} h={12} style={{ marginTop: 8 }} />
                <Skeleton w="80%" h={12} style={{ marginTop: 14 }} />
            </div>
        </div>
    );
}

export function LevelGrid({ levels, loading, count = 8 }: { levels?: LevelSummary[]; loading?: boolean; count?: number }) {
    if (loading && !levels) {
        return (
            <div className="level-grid" aria-busy="true" aria-label="Loading levels">
                {Array.from({ length: count }, (_, i) => (
                    <LevelCardSkeleton key={i} />
                ))}
            </div>
        );
    }
    return (
        <div className="level-grid">
            {levels?.map((l) => (
                <LevelCard key={l.id} level={l} />
            ))}
        </div>
    );
}
