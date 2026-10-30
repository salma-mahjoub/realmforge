import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import type { LevelSummary } from '../api/types';
import type { Theme } from '../game/level/types';

export const shortAddr = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

export function formatMs(ms: number | null | undefined): string {
    if (ms == null) return '—';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

const THEME_STYLE: Record<Theme, { sky: string; ground: string; block: string }> = {
    grass: { sky: 'linear-gradient(#7cc8ff, #c4ecff)', ground: 'linear-gradient(#5cc94a 0 18%, #8b5a2b 18%)', block: '#b7793e' },
    desert: { sky: 'linear-gradient(#ffd08a, #ffe9c2)', ground: 'linear-gradient(#f2c46b 0 18%, #c98a3e 18%)', block: '#c0583a' },
    snow: { sky: 'linear-gradient(#9fd2ff, #e3f3ff)', ground: 'linear-gradient(#ffffff 0 22%, #4f7fc8 22%)', block: '#8fc3ff' },
    castle: { sky: 'linear-gradient(#3a1f2b, #ff6a3d)', ground: 'linear-gradient(#5c6370 0 18%, #2b2f3a 18%)', block: '#ff5a1f' },
};

const BLOB_COLORS = ['#7c5cff', '#22d3ee', '#f43f5e', '#ffc83d'];

/** CSS-only scenery thumbnail (real thumbnails come from IPFS once published). */
export function LevelThumb({ theme, seed = 1, style }: { theme: Theme; seed?: number; style?: CSSProperties }) {
    const t = THEME_STYLE[theme];
    const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280;
    return (
        <div className="thumb" style={{ background: t.sky, ...style }}>
            {[0, 1, 2].map((i) => (
                <div key={i} className="blk" style={{ left: `${12 + i * 28 + r(i) * 8}%`, bottom: `${30 + r(i + 3) * 30}%`, width: `${12 + r(i + 6) * 10}%`, height: '9%', background: t.block }} />
            ))}
            {[0, 1, 2].map((i) => (
                <div key={i} className="tcoin" style={{ left: `${40 + i * 7}%`, bottom: `${58 + r(i + 9) * 10}%` }} />
            ))}
            <div className="blob" style={{ left: `${18 + r(12) * 40}%`, bottom: `${26 + r(13) * 20}%`, background: BLOB_COLORS[seed % 4] }} />
            <div className="flag" style={{ right: '10%', bottom: '22%' }} />
            <div className="ground" style={{ background: t.ground }} />
        </div>
    );
}

export function LevelCard({ level }: { level: LevelSummary }) {
    return (
        <Link to={`/level/${level.id}`} className="card">
            <LevelThumb theme={level.theme} seed={level.id} />
            <div className="card-body">
                <div className="row between">
                    <span className="card-title">{level.name}</span>
                    <span className="fee">
                        <span className="coin" style={{ width: 14, height: 14 }} /> {level.playFee} FORGE
                    </span>
                </div>
                <div className="muted mono" style={{ fontSize: 12, marginTop: 4 }}>
                    {shortAddr(level.creator)}
                </div>
                <div className="card-meta">
                    <span>▶ {compact(level.plays)} plays</span>
                    <span>🏆 {Math.round(level.clearRate * 100)}% clear</span>
                    <span>♥ {level.likes}</span>
                </div>
            </div>
        </Link>
    );
}

export function Avatar({ color, size = 38 }: { color: string; size?: number }) {
    return <span className="avatar" style={{ background: color, width: size, height: size }} />;
}

export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
