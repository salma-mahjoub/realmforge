import type { AnchorHTMLAttributes, CSSProperties, ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
export { cx };

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'gold' | 'danger' | 'outline-gold';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonOwnProps {
    variant?: ButtonVariant;
    size?: ButtonSize;
    /** Shows a spinner, sets aria-busy and disables the button. */
    loading?: boolean;
    icon?: ReactNode;
    iconRight?: ReactNode;
    block?: boolean;
    /** Router link when set (rendered as <a>). */
    to?: string;
    ref?: Ref<HTMLButtonElement>;
}

export type ButtonProps = ButtonOwnProps & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = 'secondary', size = 'md', loading, icon, iconRight, block, to, className, children, disabled, type, ref, ...rest }: ButtonProps) {
    const cls = cx('btn', `btn-${variant}`, `btn-${size}`, block && 'btn-block', loading && 'is-loading', className);
    const inner = (
        <>
            {loading ? <Loader2 className="spin" size={size === 'sm' ? 14 : 16} aria-hidden /> : icon}
            {children != null && <span className="btn-label">{children}</span>}
            {iconRight}
        </>
    );
    if (to && !disabled && !loading) {
        return (
            <Link to={to} className={cls} aria-label={rest['aria-label']} title={rest.title} onClick={rest.onClick as never}>
                {inner}
            </Link>
        );
    }
    return (
        <button ref={ref} type={type ?? 'button'} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
            {inner}
        </button>
    );
}

export function ExternalLink({ className, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
    return (
        <a className={cx('ext-link', className)} target="_blank" rel="noreferrer noopener" {...rest}>
            {children}
        </a>
    );
}

export function Card({ className, children, as: As = 'section', pad = true, ...rest }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article' | 'aside'; pad?: boolean }) {
    return (
        <As className={cx('card', pad && 'card-pad', className)} {...rest}>
            {children}
        </As>
    );
}

export function CardHeader({ title, icon, aside, id }: { title: ReactNode; icon?: ReactNode; aside?: ReactNode; id?: string }) {
    return (
        <header className="card-header">
            <h2 className="card-title" id={id}>
                {icon}
                {title}
            </h2>
            {aside && <div className="card-aside">{aside}</div>}
        </header>
    );
}

export type Tone = 'violet' | 'gold' | 'green' | 'red' | 'amber' | 'neutral' | 'cyan';

export function Badge({ tone = 'violet', className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
    return (
        <span className={cx('badge', `tone-${tone}`, className)} {...rest}>
            {children}
        </span>
    );
}

/** Status pill with a leading dot (live / offline / pending). */
export function Pill({ tone = 'neutral', pulse, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; pulse?: boolean }) {
    return (
        <span className={cx('pill', `tone-${tone}`, className)} {...rest}>
            <span className={cx('pill-dot', pulse && 'pulse')} aria-hidden />
            {children}
        </span>
    );
}

export function Kbd({ children }: { children: ReactNode }) {
    return <kbd className="kbd">{children}</kbd>;
}

export function Spinner({ size = 18, label = 'Loading' }: { size?: number; label?: string }) {
    return (
        <span role="status" className="spinner-wrap">
            <Loader2 className="spin" size={size} aria-hidden />
            <span className="sr-only">{label}</span>
        </span>
    );
}

export function Skeleton({ w, h = 14, r, className, style }: { w?: number | string; h?: number | string; r?: number; className?: string; style?: CSSProperties }) {
    return <span className={cx('skeleton', className)} style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden />;
}

export function EmptyState({ icon, title, children, action, tone = 'neutral', compact }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; tone?: 'neutral' | 'error'; compact?: boolean }) {
    return (
        <div className={cx('empty', tone === 'error' && 'empty-error', compact && 'empty-compact')} role={tone === 'error' ? 'alert' : undefined}>
            {icon && <div className="empty-icon">{icon}</div>}
            <h3 className="empty-title">{title}</h3>
            {children && <div className="empty-body">{children}</div>}
            {action && <div className="empty-action">{action}</div>}
        </div>
    );
}

export function Stat({ label, value, icon, hint, loading }: { label: ReactNode; value: ReactNode; icon?: ReactNode; hint?: ReactNode; loading?: boolean }) {
    return (
        <div className="stat">
            {icon && <span className="stat-icon" aria-hidden>{icon}</span>}
            <div className="stat-text">
                <span className="stat-label">{label}</span>
                <span className="stat-value">{loading ? <Skeleton w={64} h={22} /> : value}</span>
                {hint && <span className="stat-hint">{hint}</span>}
            </div>
        </div>
    );
}

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
    return (
        <div className={cx('field', error ? 'has-error' : null)}>
            <label className="field-label" htmlFor={htmlFor}>
                {label}
            </label>
            {children}
            {error ? (
                <span className="field-error" role="alert">
                    {error}
                </span>
            ) : (
                hint && <span className="field-hint">{hint}</span>
            )}
        </div>
    );
}

export function Input({ className, icon, suffix, ...rest }: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; suffix?: ReactNode }) {
    if (!icon && !suffix) return <input className={cx('input', className)} {...rest} />;
    return (
        <span className={cx('input-wrap', className)}>
            {icon && <span className="input-icon" aria-hidden>{icon}</span>}
            <input className={cx('input', Boolean(icon) && 'has-icon', Boolean(suffix) && 'has-suffix')} {...rest} />
            {suffix && <span className="input-suffix">{suffix}</span>}
        </span>
    );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
    return (
        <span className={cx('select-wrap', className)}>
            <select className="input select" {...rest}>
                {children}
            </select>
        </span>
    );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
    const id = useId();
    return (
        <span className="switch-row">
            <button id={id} type="button" role="switch" aria-checked={checked} aria-label={label} className={cx('switch', checked && 'on')} disabled={disabled} onClick={() => onChange(!checked)}>
                <span className="switch-knob" />
            </button>
        </span>
    );
}

/** Visually hidden text for screen readers. */
export function SrOnly({ children }: { children: ReactNode }) {
    return <span className="sr-only">{children}</span>;
}
