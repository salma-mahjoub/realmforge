import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Info, Loader2, X, XCircle } from 'lucide-react';
import { cx } from './primitives';

export type ToastTone = 'info' | 'success' | 'error' | 'pending' | 'warning';

export interface ToastAction {
    label: string;
    href?: string;
    onClick?: () => void;
}

export interface ToastItem {
    id: string;
    tone: ToastTone;
    title: ReactNode;
    body?: ReactNode;
    action?: ToastAction;
    /** ms; 0 = sticky. Pending toasts are sticky by default. */
    duration?: number;
    createdAt: number;
}

type Listener = () => void;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
    items = [...items];
    listeners.forEach((l) => l());
}

function schedule(t: ToastItem) {
    const old = timers.get(t.id);
    if (old) clearTimeout(old);
    const duration = t.duration ?? (t.tone === 'pending' ? 0 : t.tone === 'error' ? 9000 : 5000);
    if (duration > 0) timers.set(t.id, setTimeout(() => toast.dismiss(t.id), duration));
}

/** Imperative toast API, usable outside React (tx flows, API client). */
export const toast = {
    show(t: Omit<ToastItem, 'id' | 'createdAt'> & { id?: string }): string {
        const id = t.id ?? `t${++seq}`;
        const existing = items.find((i) => i.id === id);
        const next: ToastItem = { ...t, id, createdAt: existing?.createdAt ?? Date.now() };
        items = existing ? items.map((i) => (i.id === id ? next : i)) : [...items.slice(-4), next];
        schedule(next);
        emit();
        return id;
    },
    update(id: string, patch: Partial<Omit<ToastItem, 'id' | 'createdAt'>>) {
        const cur = items.find((i) => i.id === id);
        if (!cur) return toast.show({ tone: 'info', title: '', ...patch, id });
        const next = { ...cur, ...patch };
        items = items.map((i) => (i.id === id ? next : i));
        schedule(next);
        emit();
        return id;
    },
    dismiss(id: string) {
        const t = timers.get(id);
        if (t) clearTimeout(t);
        timers.delete(id);
        items = items.filter((i) => i.id !== id);
        emit();
    },
    clear() {
        timers.forEach(clearTimeout);
        timers.clear();
        items = [];
        emit();
    },
    info: (title: ReactNode, body?: ReactNode) => toast.show({ tone: 'info', title, body }),
    success: (title: ReactNode, body?: ReactNode) => toast.show({ tone: 'success', title, body }),
    error: (title: ReactNode, body?: ReactNode) => toast.show({ tone: 'error', title, body }),
    warning: (title: ReactNode, body?: ReactNode) => toast.show({ tone: 'warning', title, body }),
};

const subscribe = (l: Listener) => {
    listeners.add(l);
    return () => void listeners.delete(l);
};
const snapshot = () => items;

export function useToasts() {
    return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const ICONS: Record<ToastTone, ReactNode> = {
    info: <Info size={18} />,
    success: <CheckCircle2 size={18} />,
    error: <XCircle size={18} />,
    warning: <AlertTriangle size={18} />,
    pending: <Loader2 size={18} className="spin" />,
};

/** Renders the toast stack. Mount once (Layout). Polite live region; errors are announced assertively. */
export function Toaster() {
    const list = useToasts();
    useEffect(() => () => toast.clear(), []);
    return (
        <div className="toaster" aria-label="Notifications">
            <div aria-live="polite" aria-relevant="additions text" className="toaster-stack">
                {list.map((t) => (
                    <div key={t.id} className={cx('toast', `toast-${t.tone}`)} role={t.tone === 'error' ? 'alert' : 'status'}>
                        <span className="toast-icon" aria-hidden>
                            {ICONS[t.tone]}
                        </span>
                        <div className="toast-text">
                            <div className="toast-title">{t.title}</div>
                            {t.body && <div className="toast-body">{t.body}</div>}
                            {t.action &&
                                (t.action.href ? (
                                    <a className="toast-action" href={t.action.href} target="_blank" rel="noreferrer noopener">
                                        {t.action.label} <ExternalLink size={12} aria-hidden />
                                    </a>
                                ) : (
                                    <button type="button" className="toast-action" onClick={t.action.onClick}>
                                        {t.action.label}
                                    </button>
                                ))}
                        </div>
                        <button type="button" className="icon-btn toast-close" aria-label="Dismiss notification" onClick={() => toast.dismiss(t.id)}>
                            <X size={14} />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
