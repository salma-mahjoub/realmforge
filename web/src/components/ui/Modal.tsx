import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './primitives';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: ReactNode;
    description?: ReactNode;
    children?: ReactNode;
    footer?: ReactNode;
    size?: 'sm' | 'md' | 'lg';
    /** False while a transaction is in flight: Esc/backdrop/close button do nothing. */
    dismissible?: boolean;
    /** Render inside the nearest positioned parent instead of a full-screen portal (game overlays). */
    inline?: boolean;
    className?: string;
    icon?: ReactNode;
}

/** Accessible dialog: focus trap, Esc to close, focus restore, scroll lock, labelled by its title. */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true, inline, className, icon }: ModalProps) {
    const ref = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const descId = useId();
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;
    const dismissRef = useRef(dismissible);
    dismissRef.current = dismissible;

    useEffect(() => {
        if (!open) return;
        const previouslyFocused = document.activeElement as HTMLElement | null;
        const node = ref.current;
        const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
        (first ?? node)?.focus();
        const prevOverflow = document.body.style.overflow;
        if (!inline) document.body.style.overflow = 'hidden';

        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                if (dismissRef.current) onCloseRef.current();
                return;
            }
            if (e.key !== 'Tab' || !node) return;
            const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
            if (!items.length) return;
            const firstEl = items[0];
            const lastEl = items[items.length - 1];
            if (e.shiftKey && document.activeElement === firstEl) {
                e.preventDefault();
                lastEl.focus();
            } else if (!e.shiftKey && document.activeElement === lastEl) {
                e.preventDefault();
                firstEl.focus();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.body.style.overflow = prevOverflow;
            previouslyFocused?.focus?.();
        };
    }, [open, inline]);

    if (!open) return null;

    const dialog = (
        <div className={cx('modal-backdrop', inline && 'is-inline')} onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
            <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1} className={cx('modal', `modal-${size}`, className)}>
                <header className="modal-head">
                    {icon && <span className="modal-icon" aria-hidden>{icon}</span>}
                    <div className="modal-titles">
                        <h2 id={titleId} className="modal-title">
                            {title}
                        </h2>
                        {description && (
                            <p id={descId} className="modal-desc">
                                {description}
                            </p>
                        )}
                    </div>
                    {dismissible && (
                        <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Close dialog">
                            <X size={18} />
                        </button>
                    )}
                </header>
                {children != null && <div className="modal-body">{children}</div>}
                {footer && <footer className="modal-foot">{footer}</footer>}
            </div>
        </div>
    );
    return inline ? dialog : createPortal(dialog, document.body);
}
