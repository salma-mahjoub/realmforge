import { useEffect, useState } from 'react';
import { CATEGORIES, ELEMENTS, ELEMENT_BY_TYPE, elementsIn, type ElementDef, type PropSpec } from '../../game/level/catalog';
import type { ElementCategory, ElementType, EntityProps, LevelEntity, Waypoint } from '../../game/level/types';
import { EventBus } from '../../game/EventBus';
import { canonicalType } from '../../game/elements/bridge';
import { isPixelArt } from '../../game/assets/registry';
import { spriteThumbnail } from '../../game/render/artwork';
import { hex } from '../../components/ui';

const QUICK: ElementType[] = ['ground', 'spring', 'coin'];

function Swatch({ def }: { def: ElementDef }) {
    const [, refresh] = useState(0);
    const [theme, setTheme] = useState('snow');
    useEffect(() => {
        const ready = EventBus.subscribe('assets-ready', () => refresh((v) => v + 1));
        const level = EventBus.subscribe('editor:level-changed', (file) => setTheme(file.meta.theme));
        return () => { ready(); level(); };
    }, []);
    const image = spriteThumbnail(def.type, theme);
    if (image) return <img src={image} alt="" style={{ width: 48, height: 42, objectFit: 'contain', imageRendering: isPixelArt() ? 'pixelated' : 'auto' }} />;
    const round = def.category === 'items' || def.category === 'enemies';
    return <span className="swatch" style={{ background: hex(def.color), borderRadius: round ? 999 : 6, width: round ? 30 : 44 }} />;
}

export function Palette({ selected }: { selected: ElementType }) {
    const [cat, setCat] = useState<ElementCategory>(ELEMENT_BY_TYPE[selected]?.category ?? 'terrain');
    const pick = (t: ElementType) => EventBus.emit('editor:set-element', t);
    return (
        <aside className="palette">
            <h3 style={{ fontSize: 16 }}>Elements</h3>
            <div className="palette-cols">
                <div className="stack" style={{ gap: 4 }}>
                    {CATEGORIES.map((c) => (
                        <button key={c.id} className={`cat ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>
                            <span style={{ width: 16, textAlign: 'center' }}>{c.icon}</span> {c.label}
                        </button>
                    ))}
                </div>
                <div className="el-grid">
                    {elementsIn(cat).map((d) => (
                        <button key={d.type} className={`el ${selected === d.type ? 'active' : ''}`} onClick={() => pick(d.type)} title={d.label}>
                            <Swatch def={d} />
                            {d.label}
                        </button>
                    ))}
                </div>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
                ☝ Click or drag into level · right-drag to pan
            </span>
            <div>
                <h3 style={{ fontSize: 14, marginBottom: 8 }}>Quick access</h3>
                <div className="quick">
                    {QUICK.map((t) => {
                        const d = ELEMENT_BY_TYPE[t];
                        return (
                            <button key={t} className={`el ${selected === t ? 'active' : ''}`} onClick={() => pick(t)}>
                                <Swatch def={d} />
                                {d.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            <span className="muted" style={{ fontSize: 11 }}>
                {ELEMENTS.length} game-core elements · SPEC §3.2
            </span>
        </aside>
    );
}

/** One property row, driven by a game-core PropDescriptor (via catalog.propSpec). */
function PropInput({ spec, value, onChange }: { spec: PropSpec; value: unknown; onChange: (v: unknown) => void }) {
    const current = value ?? spec.default;
    switch (spec.kind) {
        case 'number':
            if (spec.key === 'direction') {
                return (
                    <select className="input" value={String(Number(current) < 0 ? -1 : 1)} onChange={(e) => onChange(Number(e.target.value))}>
                        <option value="-1">-1 (left / up)</option>
                        <option value="1">+1 (right / down)</option>
                    </select>
                );
            }
            return (
                <div className="row">
                    {spec.max !== undefined && spec.max <= 400 && (
                        <input type="range" className="grow" min={spec.min} max={spec.max} step={spec.step} value={Number(current ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
                    )}
                    <input className="input" style={{ width: 90 }} type="number" min={spec.min} max={spec.max} step={spec.step} value={Number(current ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
                    {spec.unit && <span className="muted">{spec.unit}</span>}
                </div>
            );
        case 'string':
            return <input className="input" value={String(current ?? '')} onChange={(e) => onChange(e.target.value)} />;
        case 'boolean':
            return (
                <label className="row" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" checked={Boolean(current)} onChange={(e) => onChange(e.target.checked)} /> {current ? 'On' : 'Off'}
                </label>
            );
        case 'link':
            return (
                <div className="row">
                    <input className="input" placeholder="entity id or group" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : /^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value)} />
                    <button className="btn sm" onClick={() => EventBus.emit('editor:set-tool', 'link')} title="Use the Link tool: click source, then target">
                        Pick
                    </button>
                </div>
            );
        case 'path': {
            const path = (Array.isArray(value) ? value : []) as Waypoint[];
            const set = (i: number, k: 'x' | 'y', v: number) => onChange(path.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
            return (
                <div className="stack" style={{ gap: 6 }}>
                    {path.map((p, i) => (
                        <div key={i} className="waypoint">
                            <span className="n">{i + 1}</span>
                            <input className="input" type="number" value={p.x} onChange={(e) => set(i, 'x', Number(e.target.value))} aria-label={`Waypoint ${i + 1} X`} />
                            <div className="row" style={{ gap: 4 }}>
                                <input className="input" type="number" value={p.y} onChange={(e) => set(i, 'y', Number(e.target.value))} aria-label={`Waypoint ${i + 1} Y`} />
                                <button className="btn sm ghost" onClick={() => onChange(path.filter((_, j) => j !== i))} aria-label="Remove waypoint">
                                    ✕
                                </button>
                            </div>
                        </div>
                    ))}
                    <button className="btn sm" onClick={() => onChange([...path, path.length ? { x: path[path.length - 1].x + 3, y: path[path.length - 1].y } : { x: 0, y: 0 }])}>
                        + Add waypoint
                    </button>
                </div>
            );
        }
    }
}

export function PropertiesPanel({ entity }: { entity: LevelEntity | null }) {
    const [draft, setDraft] = useState<EntityProps>({});
    useEffect(() => setDraft(entity?.props ?? {}), [entity]);

    if (!entity) {
        return (
            <aside className="props">
                <h3>Properties</h3>
                <p className="muted" style={{ fontSize: 14 }}>
                    Select an element with the <b>Select</b> tool to edit speed, direction, path, link target and timers.
                </p>
                <div className="panel" style={{ fontSize: 13 }}>
                    <div className="muted">Shortcuts</div>
                    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                        <span><span className="kbd">1</span>–<span className="kbd">4</span> Place / Erase / Select / Link</span>
                        <span><span className="kbd">⌘Z</span> undo · <span className="kbd">⇧⌘Z</span> redo</span>
                        <span><span className="kbd">T</span> test play · <span className="kbd">G</span> grid</span>
                        <span><span className="kbd">←↑→↓</span> scroll · <span className="kbd">Del</span> delete</span>
                    </div>
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
        <aside className="props">
            <h3>Properties</h3>
            <div className="row panel" style={{ padding: 10 }}>
                <Swatch def={def} />
                <div>
                    <b>{def.label}</b>
                    <div className="muted" style={{ fontSize: 12 }}>
                        #{entity.id} · tile ({entity.x}, {entity.y})
                    </div>
                </div>
            </div>
            {(def.props ?? []).map((spec) => (
                <div key={spec.key} className="prop-row">
                    <span>{spec.label}</span>
                    <PropInput spec={spec} value={draft[spec.key]} onChange={(v) => commit({ ...draft, [spec.key]: v })} />
                </div>
            ))}
            {!def.props?.length && <p className="muted">No editable properties.</p>}
            <div className="row" style={{ marginTop: 'auto' }}>
                <button className="btn grow" onClick={() => EventBus.emit('editor:set-element', entity.type)}>
                    ⧉ Duplicate
                </button>
                <button className="btn danger grow" onClick={() => EventBus.emit('editor:delete-selected')}>
                    🗑 Delete
                </button>
            </div>
        </aside>
    );
}
