import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Boxes, Copy, Flag, Hand, Link2, Mountain, MousePointerClick, Plus, Search, Settings2, Skull, Trash2, TriangleAlert, X } from 'lucide-react';
import { CATEGORIES, ELEMENTS, ELEMENT_BY_TYPE, elementsIn, type ElementDef, type PropSpec } from '../../game/level/catalog';
import type { ElementCategory, ElementType, EntityProps, LevelEntity, Waypoint } from '../../game/level/types';
import { EventBus } from '../../game/EventBus';
import { canonicalType } from '../../game/elements/bridge';
import { isPixelArt } from '../../game/assets/registry';
import { spriteThumbnail } from '../../game/render/artwork';
import { Button, EmptyState, Input, Kbd, Switch, cx, hex } from '../../components/ui';

const QUICK: ElementType[] = ['ground', 'spring', 'coin'];

const CAT_ICON: Record<ElementCategory, ReactNode> = {
    terrain: <Mountain size={16} aria-hidden />,
    hazards: <TriangleAlert size={16} aria-hidden />,
    dynamic: <Settings2 size={16} aria-hidden />,
    moving: <ArrowLeftRight size={16} aria-hidden />,
    enemies: <Skull size={16} aria-hidden />,
    items: <Boxes size={16} aria-hidden />,
    flow: <Flag size={16} aria-hidden />,
};

/** Re-render palette swatches once Phaser has prepared sprite thumbnails (assets-ready) or the theme changes. */
function useThumbVersion() {
    const [v, setV] = useState(0);
    const [theme, setTheme] = useState('snow');
    useEffect(() => {
        const a = EventBus.subscribe('assets-ready', () => setV((x) => x + 1));
        const b = EventBus.subscribe('editor:level-changed', (file) => setTheme(file.meta.theme));
        return () => {
            a();
            b();
        };
    }, []);
    return { v, theme };
}

/** Real sprite from the active asset pack (spriteThumbnail), colour chip only until textures load. */
export function Swatch({ def, size = 44 }: { def: ElementDef; size?: number }) {
    const { theme } = useThumbVersion();
    const image = spriteThumbnail(def.type, theme);
    if (image) return <img src={image} alt="" width={size} height={size} className="swatch-img" style={{ imageRendering: isPixelArt() ? 'pixelated' : 'auto' }} />;
    const round = def.category === 'items' || def.category === 'enemies';
    return <span className="swatch" style={{ background: hex(def.color), borderRadius: round ? 999 : 6, width: round ? size * 0.66 : size, height: size * 0.66 }} aria-hidden />;
}

function ElementButton({ def, selected, onPick, compact }: { def: ElementDef; selected: boolean; onPick: (t: ElementType) => void; compact?: boolean }) {
    return (
        <button type="button" className={cx('el', compact && 'el-compact', selected && 'is-active')} onClick={() => onPick(def.type)} aria-pressed={selected} title={`${def.label}${def.unique ? ' (one per level)' : ''}`}>
            <Swatch def={def} size={compact ? 34 : 46} />
            <span className="el-label">{def.label}</span>
        </button>
    );
}

export function Palette({ selected, disabled }: { selected: ElementType; disabled?: boolean }) {
    const [cat, setCat] = useState<ElementCategory>(ELEMENT_BY_TYPE[selected]?.category ?? 'terrain');
    const [query, setQuery] = useState('');
    useThumbVersion();
    const pick = (t: ElementType) => {
        EventBus.emit('editor:set-element', t);
        EventBus.emit('editor:set-tool', 'place');
    };
    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? ELEMENTS.filter((e) => e.label.toLowerCase().includes(q) || e.type.includes(q) || e.category.includes(q)) : null;
    }, [query]);

    return (
        <aside className={cx('palette', disabled && 'is-disabled')} aria-label="Elements palette">
            <div className="panel-title-row">
                <h2 className="panel-title">Elements</h2>
                <span className="fine">{ELEMENTS.length}</span>
            </div>
            <Input icon={<Search size={15} />} type="search" placeholder="Search elements" aria-label="Search elements" value={query} onChange={(e) => setQuery(e.target.value)} />
            {results ? (
                results.length ? (
                    <div className="el-grid el-grid-wide" role="group" aria-label="Search results">
                        {results.map((d) => (
                            <ElementButton key={d.type} def={d} selected={selected === d.type} onPick={pick} />
                        ))}
                    </div>
                ) : (
                    <EmptyState compact title="No element matches" action={<Button size="sm" variant="ghost" icon={<X size={14} aria-hidden />} onClick={() => setQuery('')}>Clear search</Button>} />
                )
            ) : (
                <div className="palette-cols">
                    <div className="cats" role="tablist" aria-label="Element categories" aria-orientation="vertical">
                        {CATEGORIES.map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                role="tab"
                                aria-selected={cat === c.id}
                                tabIndex={cat === c.id ? 0 : -1}
                                className={cx('cat', cat === c.id && 'is-active')}
                                onClick={() => setCat(c.id)}
                                onKeyDown={(e) => {
                                    const i = CATEGORIES.findIndex((x) => x.id === cat);
                                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        const n = CATEGORIES[(i + (e.key === 'ArrowDown' ? 1 : CATEGORIES.length - 1)) % CATEGORIES.length];
                                        setCat(n.id);
                                        (e.currentTarget.parentElement?.querySelectorAll('button')[CATEGORIES.indexOf(n)] as HTMLButtonElement | undefined)?.focus();
                                    }
                                }}
                            >
                                {CAT_ICON[c.id]}
                                <span>{c.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="el-grid" role="tabpanel" aria-label={CATEGORIES.find((c) => c.id === cat)?.label}>
                        {elementsIn(cat).map((d) => (
                            <ElementButton key={d.type} def={d} selected={selected === d.type} onPick={pick} />
                        ))}
                    </div>
                </div>
            )}
            <p className="palette-hint">
                <Hand size={14} aria-hidden /> Click to place · right-drag to pan
            </p>
            <div className="quick">
                <h3 className="mini-title">Quick access</h3>
                <div className="quick-grid">
                    {QUICK.map((t) => (
                        <ElementButton key={t} def={ELEMENT_BY_TYPE[t]} selected={selected === t} onPick={pick} compact />
                    ))}
                </div>
            </div>
        </aside>
    );
}

/** One property row, driven by a game-core PropDescriptor (via catalog.propSpec). */
function PropInput({ spec, value, onChange, id }: { spec: PropSpec; value: unknown; onChange: (v: unknown) => void; id: string }) {
    const current = value ?? spec.default;
    switch (spec.kind) {
        case 'number':
            if (spec.key === 'direction') {
                return (
                    <div className="seg" role="radiogroup" aria-labelledby={`${id}-label`}>
                        {[
                            [-1, 'Left / up'],
                            [1, 'Right / down'],
                        ].map(([v, l]) => (
                            <button key={v} type="button" role="radio" aria-checked={(Number(current) < 0 ? -1 : 1) === v} className={cx('seg-btn', (Number(current) < 0 ? -1 : 1) === v && 'is-active')} onClick={() => onChange(v)}>
                                {l}
                            </button>
                        ))}
                    </div>
                );
            }
            return (
                <div className="prop-number">
                    {spec.max !== undefined && spec.max <= 400 && (
                        <input type="range" className="range" min={spec.min} max={spec.max} step={spec.step} value={Number(current ?? 0)} onChange={(e) => onChange(Number(e.target.value))} aria-labelledby={`${id}-label`} />
                    )}
                    <Input id={id} type="number" min={spec.min} max={spec.max} step={spec.step} value={Number(current ?? 0)} onChange={(e) => onChange(Number(e.target.value))} suffix={spec.unit} className="prop-num-input" />
                </div>
            );
        case 'string':
            return <Input id={id} value={String(current ?? '')} onChange={(e) => onChange(e.target.value)} />;
        case 'boolean':
            return <Switch checked={Boolean(current)} onChange={onChange} label={spec.label} />;
        case 'link':
            return (
                <div className="prop-link">
                    <Input id={id} placeholder="Entity id or group" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)} />
                    <Button size="sm" icon={<Link2 size={14} aria-hidden />} onClick={() => EventBus.emit('editor:set-tool', 'link')} title="Use the Link tool: click source, then target">
                        Pick
                    </Button>
                </div>
            );
        case 'path': {
            const path = (Array.isArray(value) ? value : []) as Waypoint[];
            const set = (i: number, k: 'x' | 'y', v: number) => onChange(path.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
            return (
                <div className="path-list">
                    {path.map((p, i) => (
                        <div key={i} className="waypoint">
                            <span className="wp-n">{i + 1}</span>
                            <Input type="number" value={p.x} onChange={(e) => set(i, 'x', Number(e.target.value))} aria-label={`Waypoint ${i + 1} X`} icon={<span className="axis">X</span>} />
                            <Input type="number" value={p.y} onChange={(e) => set(i, 'y', Number(e.target.value))} aria-label={`Waypoint ${i + 1} Y`} icon={<span className="axis">Y</span>} />
                            <button type="button" className="icon-btn icon-btn-xs" onClick={() => onChange(path.filter((_, j) => j !== i))} aria-label={`Remove waypoint ${i + 1}`}>
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                    <Button size="sm" block icon={<Plus size={14} aria-hidden />} onClick={() => onChange([...path, path.length ? { x: path[path.length - 1].x + 3, y: path[path.length - 1].y } : { x: 0, y: 0 }])}>
                        Add waypoint
                    </Button>
                </div>
            );
        }
    }
}

export function PropertiesPanel({ entity, testing }: { entity: LevelEntity | null; testing?: boolean }) {
    const [draft, setDraft] = useState<EntityProps>({});
    useEffect(() => setDraft(entity?.props ?? {}), [entity]);

    if (testing || !entity) {
        return (
            <aside className="props" aria-label="Properties">
                <h2 className="panel-title">Properties</h2>
                <EmptyState compact icon={<MousePointerClick size={22} />} title={testing ? 'Test play running' : 'Nothing selected'}>
                    {testing ? (
                        <>
                            Press <Kbd>T</Kbd> to return to the editor at the same spot.
                        </>
                    ) : (
                        <>
                            Pick the <b>Select</b> tool (<Kbd>3</Kbd>) and click an element to edit its speed, path, links and timers.
                        </>
                    )}
                </EmptyState>
                <div className="shortcut-card">
                    <h3 className="mini-title">Shortcuts</h3>
                    <ul>
                        <li>
                            <span>
                                <Kbd>1</Kbd>–<Kbd>4</Kbd>
                            </span>
                            Place · Erase · Select · Link
                        </li>
                        <li>
                            <span>
                                <Kbd>⌘Z</Kbd> <Kbd>⇧⌘Z</Kbd>
                            </span>
                            Undo · Redo
                        </li>
                        <li>
                            <span>
                                <Kbd>T</Kbd>
                            </span>
                            Test play
                        </li>
                        <li>
                            <span>
                                <Kbd>G</Kbd>
                            </span>
                            Grid
                        </li>
                        <li>
                            <span>
                                <Kbd>?</Kbd>
                            </span>
                            All shortcuts
                        </li>
                    </ul>
                </div>
            </aside>
        );
    }

    const def = ELEMENT_BY_TYPE[canonicalType(entity.type) ?? entity.type];
    const commit = (next: EntityProps) => {
        setDraft(next);
        EventBus.emit('editor:update-props', { id: entity.id, props: next });
    };

    return (
        <aside className="props" aria-label="Properties">
            <h2 className="panel-title">Properties</h2>
            <div className="prop-hero">
                <span className="prop-hero-thumb">
                    <Swatch def={def} size={48} />
                </span>
                <div>
                    <b>{def.label}</b>
                    <span className="fine">
                        #{entity.id} · tile ({entity.x}, {entity.y})
                    </span>
                </div>
            </div>
            <div className="prop-list">
                {(def.props ?? []).map((spec) => {
                    const id = `prop-${entity.id}-${spec.key}`;
                    return (
                        <div key={spec.key} className={cx('prop-row', spec.kind === 'boolean' && 'prop-row-inline')}>
                            <label className="prop-label" id={`${id}-label`} htmlFor={id}>
                                {spec.label}
                            </label>
                            <PropInput id={id} spec={spec} value={draft[spec.key]} onChange={(v) => commit({ ...draft, [spec.key]: v })} />
                        </div>
                    );
                })}
                {!def.props?.length && <p className="fine">This element has no editable properties.</p>}
            </div>
            <div className="prop-actions">
                <Button icon={<Copy size={15} aria-hidden />} onClick={() => { EventBus.emit('editor:set-element', entity.type); EventBus.emit('editor:set-tool', 'place'); }} title="Place copies of this element">
                    Duplicate
                </Button>
                <Button variant="danger" icon={<Trash2 size={15} aria-hidden />} onClick={() => EventBus.emit('editor:delete-selected')} title="Delete (Del)">
                    Delete
                </Button>
            </div>
        </aside>
    );
}
