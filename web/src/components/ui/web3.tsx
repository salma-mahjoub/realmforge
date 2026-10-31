import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cx } from './primitives';
import { formatAmount, shortAddr } from './format';
import { toast } from './Toast';

/** FORGE coin mark (flat SVG, gold rim + face). */
export function ForgeCoin({ size = 18, className }: { size?: number; className?: string }) {
    return (
        <svg className={cx('forge-coin', className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
            <circle cx="12" cy="12" r="11" fill="#d99a00" />
            <circle cx="12" cy="11.2" r="10" fill="#ffc83d" />
            <circle cx="12" cy="11.2" r="6.6" fill="none" stroke="#e8a800" strokeWidth="1.6" />
            <path d="M10 7.6h4.6v1.8h-2.6v1.4h2.2v1.8h-2.2v3H10z" fill="#9a6400" />
        </svg>
    );
}

export function EthMark({ size = 14 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
            <path d="M12 2 5 12.2l7 4.1 7-4.1z" fill="#a9b3ff" />
            <path d="m12 17.6-7-4.1L12 22l7-8.5z" fill="#7f8bf0" />
        </svg>
    );
}

/** An amount with its token: `<TokenAmount value="5" />` → coin 5 FORGE. */
export function TokenAmount({ value, symbol = 'FORGE', size = 'md', sign, className, maxFrac = 2, tone = 'gold' }: { value: string | number | null | undefined; symbol?: 'FORGE' | 'ETH'; size?: 'sm' | 'md' | 'lg' | 'xl'; sign?: '+' | '-'; className?: string; maxFrac?: number; tone?: 'gold' | 'plain' }) {
    const px = { sm: 14, md: 16, lg: 22, xl: 28 }[size];
    return (
        <span className={cx('token-amount', `ta-${size}`, tone === 'gold' && symbol === 'FORGE' && 'is-gold', className)}>
            {symbol === 'FORGE' ? <ForgeCoin size={px} /> : <EthMark size={px - 2} />}
            <span className="num">
                {sign}
                {formatAmount(value, maxFrac)}
            </span>
            <span className="sym">{symbol}</span>
        </span>
    );
}

const AVATAR_COLORS = ['#7c5cff', '#22d3ee', '#ff5c7a', '#ffc83d', '#3ddc97', '#ff8a3d', '#5b8cff', '#e05cff'];
export const colorForAddress = (a?: string) => {
    if (!a) return AVATAR_COLORS[0];
    let h = 0;
    for (let i = 2; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

/** Round blob avatar in the style of the mockups' racers (two eyes). */
export function Avatar({ color, address, size = 36, className, style }: { color?: string; address?: string; size?: number; className?: string; style?: CSSProperties }) {
    return <span className={cx('avatar', className)} style={{ background: color ?? colorForAddress(address), width: size, height: size, ...style }} aria-hidden />;
}

/** Address with copy button and optional profile link. Full address in title + aria-label. */
export function AddressChip({ address, link = true, copy = true, avatar, className, label }: { address?: string | null; link?: boolean; copy?: boolean; avatar?: boolean; className?: string; label?: string }) {
    const [copied, setCopied] = useState(false);
    if (!address) return <span className="muted">—</span>;
    const text = label ?? shortAddr(address);
    const doCopy = async () => {
        try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            toast.show({ tone: 'success', title: 'Address copied', body: shortAddr(address, 10, 8), duration: 2200 });
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Could not copy', 'Clipboard access was blocked by the browser.');
        }
    };
    return (
        <span className={cx('address-chip', className)}>
            {avatar && <Avatar address={address} size={20} />}
            {link ? (
                <Link to={`/profile/${address}`} className="address-text" title={address} aria-label={`Profile of ${address}`}>
                    {text}
                </Link>
            ) : (
                <span className="address-text" title={address}>
                    {text}
                </span>
            )}
            {copy && (
                <button type="button" className="icon-btn icon-btn-xs" onClick={() => void doCopy()} aria-label={`Copy address ${address}`}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
            )}
        </span>
    );
}
