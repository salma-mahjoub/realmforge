/** Pure formatting helpers shared by pages and components (unit-tested in format.test.ts). */

export const shortAddr = (a?: string | null, head = 6, tail = 4) => (a ? (a.length <= head + tail + 1 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`) : '—');

export function formatMs(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms)) return '—';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export const compact = (n: number) => {
    if (!Number.isFinite(n)) return '—';
    if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    return String(n);
};

/** Thousands separators, keeps up to `maxFrac` decimals of a decimal string or number. */
export function formatAmount(v: string | number | null | undefined, maxFrac = 2): string {
    if (v == null || v === '') return '—';
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}

export const pct = (ratio: number) => (Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : '—');

export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function timeAgo(date: Date | string | number, now = Date.now()): string {
    const t = typeof date === 'object' ? date.getTime() : new Date(date).getTime();
    if (!Number.isFinite(t)) return '—';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
}
