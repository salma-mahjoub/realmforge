import { cloneElement, isValidElement, useId, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { cx } from './primitives';

export interface TabItem<T extends string> {
    id: T;
    label: ReactNode;
    count?: number;
    icon?: ReactNode;
}

/** WAI-ARIA tablist with roving tabindex and arrow/Home/End keys. `variant="segmented"` for filter chips. */
export function Tabs<T extends string>({ items, value, onChange, label, variant = 'segmented', idBase, className }: { items: TabItem<T>[]; value: T; onChange: (v: T) => void; label: string; variant?: 'segmented' | 'underline'; idBase?: string; className?: string }) {
    const auto = useId();
    const base = idBase ?? auto;
    const refs = useRef<Array<HTMLButtonElement | null>>([]);
    const onKey = (e: KeyboardEvent, i: number) => {
        let next = -1;
        if (e.key === 'ArrowRight') next = (i + 1) % items.length;
        else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = items.length - 1;
        if (next < 0) return;
        e.preventDefault();
        refs.current[next]?.focus();
        onChange(items[next].id);
    };
    return (
        <div role="tablist" aria-label={label} className={cx('tabs', `tabs-${variant}`, className)}>
            {items.map((t, i) => {
                const selected = t.id === value;
                return (
                    <button
                        key={t.id}
                        ref={(el) => {
                            refs.current[i] = el;
                        }}
                        role="tab"
                        type="button"
                        id={`${base}-tab-${t.id}`}
                        aria-selected={selected}
                        aria-controls={`${base}-panel`}
                        tabIndex={selected ? 0 : -1}
                        className={cx('tab', selected && 'is-active')}
                        onClick={() => onChange(t.id)}
                        onKeyDown={(e) => onKey(e, i)}
                    >
                        {t.icon}
                        {t.label}
                        {t.count != null && <span className="tab-count">{t.count}</span>}
                    </button>
                );
            })}
        </div>
    );
}

export function TabPanel({ idBase, active, children, className }: { idBase: string; active: string; children: ReactNode; className?: string }) {
    return (
        <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${active}`} className={className}>
            {children}
        </div>
    );
}

/** Hover/focus tooltip. Wraps one element; adds aria-describedby. Optional shortcut hint. */
export function Tooltip({ content, shortcut, children, side = 'bottom' }: { content: ReactNode; shortcut?: string; children: ReactElement; side?: 'top' | 'bottom' | 'left' | 'right' }) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const show = () => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setOpen(true), 250);
    };
    const hide = () => {
        clearTimeout(timer.current);
        setOpen(false);
    };
    const child = isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'aria-describedby': id }) : children;
    return (
        <span className="tooltip-anchor" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onKeyDown={(e) => e.key === 'Escape' && hide()}>
            {child}
            <span role="tooltip" id={id} className={cx('tooltip', `tooltip-${side}`, open && 'is-open')}>
                {content}
                {shortcut && <kbd className="kbd kbd-tip">{shortcut}</kbd>}
            </span>
        </span>
    );
}
