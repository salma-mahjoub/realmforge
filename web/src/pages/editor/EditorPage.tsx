import { useEffect, useRef, useState } from 'react';
import { PhaserGame } from '../../game/PhaserGame';
import { EventBus, type EditorStatus, type EditorTool } from '../../game/EventBus';
import { SCENES } from '../../game/constants';
import { SAMPLE_LEVEL, loadAutosave } from '../../game/level';
import { layoutHash } from '../../game/level/serialize';
import { THEMES, type LevelEntity, type LevelFileV1, type Theme } from '../../game/level/types';
import { Palette, PropertiesPanel } from './Panels';
import { PublishModal, type CreatorClear } from './PublishModal';
import { formatMs } from '../../components/ui';

const TOOLS: { id: EditorTool; label: string; icon: string; key: string }[] = [
    { id: 'place', label: 'Place', icon: '✚', key: '1' },
    { id: 'erase', label: 'Erase', icon: '⌫', key: '2' },
    { id: 'select', label: 'Select', icon: '⬚', key: '3' },
    { id: 'link', label: 'Link', icon: '🔗', key: '4' },
];

const INITIAL_STATUS: EditorStatus = { tool: 'place', element: 'ground', mode: 'edit', canUndo: false, canRedo: false, zoom: 1, grid: true, cursor: null, dirty: false };

export default function EditorPage() {
    const [status, setStatus] = useState<EditorStatus>(INITIAL_STATUS);
    const [mode, setMode] = useState<'edit' | 'test'>('edit');
    const [selection, setSelection] = useState<LevelEntity | null>(null);
    const [level, setLevel] = useState<LevelFileV1>(() => loadAutosave() ?? SAMPLE_LEVEL);
    const [savedAt, setSavedAt] = useState<Date | null>(null);
    const [clear, setClear] = useState<CreatorClear | null>(null);
    const [publishing, setPublishing] = useState(false);
    const levelRef = useRef(level);
    levelRef.current = level;
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const offs = [
            EventBus.subscribe('editor:status', setStatus),
            EventBus.subscribe('editor:selection', setSelection),
            EventBus.subscribe('editor:level-changed', (l) => {
                setLevel(l);
                setSavedAt(new Date());
            }),
            EventBus.subscribe('current-scene-ready', (s) => setMode(s.scene.key === SCENES.Editor ? 'edit' : 'test')),
            EventBus.subscribe('play:finished', (r) => {
                // Only a clear from the level spawn counts for the server-signed ClearProof.
                if (!r.fromSpawn) return;
                const l = levelRef.current;
                setClear({ hash: layoutHash(l), timeMs: r.timeMs, inputs: r.inputs, run: r.run });
            }),
        ];
        return () => offs.forEach((o) => o());
    }, []);

    const loadLevel = (l: LevelFileV1) => {
        setLevel(l);
        EventBus.emit('editor:load-level', l);
    };

    const setMeta = (patch: Partial<LevelFileV1['meta']>) => loadLevel({ ...level, meta: { ...level.meta, ...patch } });

    const exportJson = () => {
        const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${level.meta.name.replace(/\W+/g, '-').toLowerCase() || 'level'}.level.v1.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const importJson = async (f: File) => {
        const parsed = JSON.parse(await f.text()) as LevelFileV1;
        if (parsed.schema !== 1) throw new Error('Unsupported level schema');
        loadLevel(parsed);
    };

    const cleared = clear?.hash === layoutHash(level);

    return (
        <div className="editor">
            <div className="editor-head">
                <input
                    className="title-input"
                    defaultValue={level.meta.name}
                    key={level.meta.name}
                    onBlur={(e) => e.target.value !== level.meta.name && setMeta({ name: e.target.value || 'Untitled level' })}
                    aria-label="Level name"
                />
                <span className="badge gray">Draft</span>
                <select className="input" style={{ width: 120 }} value={level.meta.theme} onChange={(e) => setMeta({ theme: e.target.value as Theme, music: `${e.target.value}_01` })}>
                    {THEMES.map((t) => (
                        <option key={t} value={t}>
                            ❄ {t[0].toUpperCase() + t.slice(1)}
                        </option>
                    ))}
                </select>
                <span className="muted" style={{ fontSize: 13 }}>
                    {savedAt ? `✓ Saved ${savedAt.toLocaleTimeString()}` : '✓ Autosave on'}
                    {cleared && <span className="green"> · Cleared in {formatMs(clear!.timeMs)}</span>}
                </span>
                <div className="row" style={{ marginLeft: 'auto' }}>
                    <button className="btn sm ghost" onClick={exportJson}>
                        Export JSON
                    </button>
                    <button className="btn sm ghost" onClick={() => fileInput.current?.click()}>
                        Import
                    </button>
                    <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importJson(e.target.files[0]).catch((err: Error) => alert(err.message))} />
                    <button className={`btn ${mode === 'test' ? 'active' : 'primary'}`} onClick={() => EventBus.emit('editor:toggle-test')}>
                        ▶ {mode === 'test' ? 'Back to edit (T)' : 'Test Play (T)'}
                    </button>
                    <button className="btn gold" onClick={() => setPublishing(true)}>
                        ⇪ Publish
                    </button>
                </div>
            </div>

            <div className="toolbar">
                {TOOLS.map((t) => (
                    <button key={t.id} className={`btn sm ${status.tool === t.id ? 'active' : ''}`} onClick={() => EventBus.emit('editor:set-tool', t.id)} title={`${t.label} (${t.key})`} disabled={mode === 'test'}>
                        {t.icon} {t.label}
                    </button>
                ))}
                <span className="sep" />
                <button className="btn sm" disabled={!status.canUndo || mode === 'test'} onClick={() => EventBus.emit('editor:undo')} title="Undo (⌘Z)">
                    ↶ Undo
                </button>
                <button className="btn sm" disabled={!status.canRedo || mode === 'test'} onClick={() => EventBus.emit('editor:redo')} title="Redo (⇧⌘Z)">
                    ↷ Redo
                </button>
                <span className="sep" />
                <button className="btn sm" onClick={() => EventBus.emit('editor:toggle-test')}>
                    ▶ Test Play
                </button>
                <button className="btn sm gold" onClick={() => setPublishing(true)}>
                    ⇪ Publish
                </button>
                <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
                    <button className={`btn sm ${status.grid ? 'active' : ''}`} onClick={() => EventBus.emit('editor:toggle-grid')}>
                        ▦ Grid {status.grid ? 'on' : 'off'}
                    </button>
                    <button className="btn sm" onClick={() => EventBus.emit('editor:zoom', status.zoom - 0.1)}>
                        −
                    </button>
                    <span className="mono" style={{ width: 52, textAlign: 'center' }}>
                        {Math.round(status.zoom * 100)}%
                    </span>
                    <button className="btn sm" onClick={() => EventBus.emit('editor:zoom', status.zoom + 0.1)}>
                        +
                    </button>
                </div>
            </div>

            <div className="editor-body">
                <Palette selected={status.element} />
                <div className="canvas-wrap">
                    <span className="badge" style={{ position: 'absolute', top: 20, left: 20, zIndex: 2, background: mode === 'test' ? 'var(--gold)' : 'var(--violet)', color: mode === 'test' ? '#1a1405' : '#fff' }}>
                        {mode === 'test' ? 'TEST PLAY — press T to edit' : status.tool === 'link' ? 'LINK MODE — click source, then target' : 'EDIT MODE'}
                    </span>
                    <PhaserGame scene={SCENES.Editor} data={{ level }} />
                </div>
                <PropertiesPanel entity={mode === 'edit' ? selection : null} />
            </div>

            <div className="statusbar">
                <span>
                    {level.meta.theme[0].toUpperCase() + level.meta.theme.slice(1)} · {level.size.w} × {level.size.h} tiles · {level.entities.length} elements
                </span>
                <span>{status.cursor ? `cursor (${status.cursor.x}, ${status.cursor.y})` : ''}</span>
                <span style={{ marginLeft: 'auto' }}>
                    <span className="kbd">T</span> {mode === 'test' ? 'Back to edit' : 'Test play'}
                </span>
            </div>

            {publishing && <PublishModal level={level} clear={clear} onClose={() => setPublishing(false)} />}
        </div>
    );
}
