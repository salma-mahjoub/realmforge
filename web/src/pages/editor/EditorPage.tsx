import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Castle, Check, CheckCircle2, Download, Eraser, FlipHorizontal, GitFork, Grid3x3, Info, Keyboard, Link2, MousePointer2, Pencil, Play, Plus, Redo2, Rocket, RotateCcw, Snowflake, Square, Sun, TreePine, Undo2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { PhaserGame } from '../../game/PhaserGame';
import { EventBus, type EditorStatus, type EditorTool } from '../../game/EventBus';
import { SCENES } from '../../game/constants';
import { SAMPLE_LEVEL, loadAutosave, saveAutosave } from '../../game/level';
import { gameplayHash, loadRemixSource, makeRemix, parseRemixParam, remixSourceOf, remixStatus, saveRemixSource, type RemixSource } from '../../game/level/remix';
import { api } from '../../api/client';
import { layoutHash } from '../../game/level/serialize';
import { THEMES, type LevelEntity, type LevelFileV1, type Theme } from '../../game/level/types';
import { ELEMENT_BY_TYPE } from '../../game/level/catalog';
import { Palette, PropertiesPanel } from './Panels';
import { PublishModal, type CreatorClear } from './PublishModal';
import { AVAILABLE_MUSIC, createTemplate, isAvailableMusic, LEVEL_TEMPLATES, type LevelTemplateId, validatedMusic } from '../../game/editor/templates';
import { Badge, Button, EmptyState, Kbd, Modal, Select, Spinner, Tooltip, capitalize, cx, formatMs, timeAgo, toast } from '../../components/ui';

const TOOLS: { id: EditorTool; label: string; icon: ReactNode; key: string; hint: string }[] = [
    { id: 'place', label: 'Place', icon: <Plus size={16} aria-hidden />, key: '1', hint: 'Place the selected element' },
    { id: 'erase', label: 'Erase', icon: <Eraser size={16} aria-hidden />, key: '2', hint: 'Erase tiles and elements' },
    { id: 'select', label: 'Select', icon: <Square size={16} aria-hidden strokeDasharray="3 3" />, key: '3', hint: 'Select, drag and edit properties' },
    { id: 'link', label: 'Link', icon: <Link2 size={16} aria-hidden />, key: '4', hint: 'Link doors and switches: source, then target' },
];

const THEME_ICON: Record<Theme, ReactNode> = {
    grass: <TreePine size={15} aria-hidden />,
    desert: <Sun size={15} aria-hidden />,
    snow: <Snowflake size={15} aria-hidden />,
    castle: <Castle size={15} aria-hidden />,
};

const SHORTCUTS: [string[], string][] = [
    [['1'], 'Place tool'],
    [['2'], 'Erase tool'],
    [['3'], 'Select tool'],
    [['4'], 'Link tool'],
    [['T'], 'Toggle test play (from the cursor)'],
    [['G'], 'Toggle grid'],
    [['⌘/Ctrl', 'Z'], 'Undo'],
    [['⇧', '⌘/Ctrl', 'Z'], 'Redo (also ⌘/Ctrl Y)'],
    [['⌘/Ctrl', 'C'], 'Copy selection'],
    [['⌘/Ctrl', 'X'], 'Cut selection'],
    [['⌘/Ctrl', 'V'], 'Paste at cursor'],
    [['Del'], 'Delete selection'],
    [['Esc'], 'Deselect / leave test play'],
    [['←', '↑', '→', '↓'], 'Scroll the level'],
    [['Right-drag'], 'Pan'],
    [['?'], 'This overlay'],
];

const INITIAL_STATUS: EditorStatus = { tool: 'place', element: 'ground', mode: 'edit', canUndo: false, canRedo: false, zoom: 1, grid: true, cursor: null, dirty: false };

/** One sticky id so a re-clear replaces the nudge instead of stacking copies. */
const CLEARED_TOAST = 'editor-cleared';
const REMIX_TOAST = 'editor-remix';

/** `/editor?remix=<id>`: fetching the parent JSON, asking before replacing a draft, or a fetch error. */
type RemixLoad = { id: number; stage: 'loading' } | { id: number; stage: 'confirm'; file: LevelFileV1; source: RemixSource } | { id: number; stage: 'error'; error: string };

export default function EditorPage() {
    const [status, setStatus] = useState<EditorStatus>(INITIAL_STATUS);
    const [mode, setMode] = useState<'edit' | 'test'>('edit');
    const [selection, setSelection] = useState<LevelEntity | null>(null);
    const [level, setLevel] = useState<LevelFileV1>(() => {
        const stored = loadAutosave() ?? SAMPLE_LEVEL;
        return { ...stored, meta: { ...stored.meta, music: validatedMusic(stored.meta.theme, stored.meta.music) } };
    });
    const [params, setParams] = useSearchParams();
    const playOnOpen = useRef(params.get('play') === '1');
    useEffect(() => {
        if (!params.has('play')) return;
        const next = new URLSearchParams(params);
        next.delete('play');
        setParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const remixParam = parseRemixParam(params.get('remix'));
    // The Phaser scene reads its level once at mount, so the canvas waits until the remix copy is ready.
    const [remixLoad, setRemixLoad] = useState<RemixLoad | null>(() => (remixParam ? { id: remixParam, stage: 'loading' } : null));
    const [remixSource, setRemixSource] = useState<RemixSource | null>(loadRemixSource);
    const [savedAt, setSavedAt] = useState<Date | null>(null);
    const [, tick] = useState(0);
    const [clear, setClear] = useState<CreatorClear | null>(null);
    const [publishing, setPublishing] = useState(false);
    // The "cleared, publish now" nudge is done once the publish dialog opens.
    useEffect(() => {
        if (publishing) toast.dismiss(CLEARED_TOAST);
    }, [publishing]);
    const [shortcuts, setShortcuts] = useState(false);
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
            EventBus.subscribe('current-scene-ready', (s) => {
                setMode(s.scene.key === SCENES.Editor ? 'edit' : 'test');
                // /editor?play=1 (a "Made by us" level): jump straight into test play once, then drop the flag
                if (s.scene.key === SCENES.Editor && playOnOpen.current) {
                    playOnOpen.current = false;
                    setTimeout(() => EventBus.emit('editor:toggle-test'), 150);
                }
            }),
            EventBus.subscribe('play:finished', (r) => {
                // Only a clear from the level spawn counts for the server-signed ClearProof.
                if (!r.fromSpawn) {
                    toast.show({ tone: 'warning', title: `Cleared in ${formatMs(r.timeMs)}, but not from spawn`, body: 'Publishing needs a clear that starts at the spawn point. Move the cursor to the start and test again.' });
                    return;
                }
                const l = levelRef.current;
                setClear({ hash: layoutHash(l), timeMs: r.timeMs, inputs: r.inputs, run: r.run });
                toast.show({ id: CLEARED_TOAST, tone: 'success', title: `Level cleared in ${formatMs(r.timeMs)}`, body: 'This layout is ready to publish.', action: { label: 'Publish now', onClick: () => setPublishing(true) } });
            }),
        ];
        const t = setInterval(() => tick((n) => n + 1), 30_000);
        return () => {
            offs.forEach((o) => o());
            clearInterval(t);
        };
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
            if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
                e.preventDefault();
                setShortcuts((v) => !v);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (!remixParam) return;
        let alive = true;
        setRemixLoad({ id: remixParam, stage: 'loading' });
        api.getLevelFileLive(remixParam)
            .then((parent) => {
                if (!alive) return;
                const file = makeRemix(parent, remixParam);
                const source = remixSourceOf(parent, remixParam);
                const draft = loadAutosave();
                // Ask before replacing real work: any draft other than the bundled sample or an untouched copy of this parent.
                const keep = draft && layoutHash(draft) !== layoutHash(SAMPLE_LEVEL) && gameplayHash(draft) !== source.gameplayHash;
                if (keep) setRemixLoad({ id: remixParam, stage: 'confirm', file, source });
                else startRemix(file, source);
            })
            .catch((err: unknown) => alive && setRemixLoad({ id: remixParam, stage: 'error', error: err instanceof Error ? err.message : String(err) }));
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remixParam]);

    const dropRemixParam = () => {
        const next = new URLSearchParams(params);
        next.delete('remix');
        setParams(next, { replace: true });
    };

    function startRemix(file: LevelFileV1, source: RemixSource) {
        saveAutosave(file);
        saveRemixSource(source);
        setRemixSource(source);
        setLevel(file);
        setClear(null);
        setRemixLoad(null);
        dropRemixParam();
        toast.show({ id: REMIX_TOAST, tone: 'info', title: `Remixing #${source.id} ${source.name}`, body: 'Change something in the layout, clear it from spawn, then publish it as a child LevelNFT.' });
    }

    const cancelRemix = () => {
        setRemixLoad(null);
        dropRemixParam();
    };

    /** Turn the remix into an original level (parentId 0). */
    const detachRemix = () => {
        saveRemixSource(null);
        setRemixSource(null);
        const { parentId: _p, ...meta } = level.meta;
        void _p;
        loadLevel({ ...level, meta });
    };

    const loadLevel = (l: LevelFileV1) => {
        const validated = { ...l, meta: { ...l.meta, music: validatedMusic(l.meta.theme, l.meta.music) } };
        setLevel(validated);
        EventBus.emit('editor:load-level', validated);
    };
    const setMeta = (patch: Partial<LevelFileV1['meta']>) => loadLevel({ ...level, meta: { ...level.meta, ...patch } });

    const exportJson = () => {
        const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${level.meta.name.replace(/\W+/g, '-').toLowerCase() || 'level'}.level.v1.json`;
        a.click();
        URL.revokeObjectURL(a.href);
        toast.success('Level exported', a.download);
    };

    const importJson = async (f: File) => {
        try {
            const parsed = JSON.parse(await f.text()) as LevelFileV1;
            if (parsed.schema !== 1 || !parsed.meta || !parsed.size) throw new Error('Not a level.v1.json file (schema 1 expected).');
            loadLevel(parsed);
            toast.success('Level imported', parsed.meta.name);
        } catch (err) {
            toast.error('Import failed', err instanceof Error ? err.message : String(err));
        }
    };

    const testing = mode === 'test';
    const remix = remixStatus(level, remixSource);
    const cleared = clear?.hash === layoutHash(level);
    const toggleTest = () => EventBus.emit('editor:toggle-test');

    return (
        <div className={cx('editor', testing && 'is-testing', remix.parentId > 0 && 'has-remix')}>
            <div className="editor-head">
                <div className="editor-title">
                    <label htmlFor="level-name" className="sr-only">
                        Level name
                    </label>
                    <input
                        id="level-name"
                        className="title-input"
                        defaultValue={level.meta.name}
                        key={level.meta.name}
                        maxLength={48}
                        onBlur={(e) => e.target.value !== level.meta.name && setMeta({ name: e.target.value.trim() || 'Untitled level' })}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <Pencil size={14} className="title-pencil" aria-hidden />
                </div>
                <Badge tone="neutral">Draft</Badge>
                <span className="theme-select">
                    <span className="theme-icon">{THEME_ICON[level.meta.theme]}</span>
                    <Select aria-label="Theme" value={level.meta.theme} onChange={(e) => setMeta({ theme: e.target.value as Theme })}>
                        {THEMES.map((t) => (
                            <option key={t} value={t}>
                                {capitalize(t)}
                            </option>
                        ))}
                    </Select>
                </span>
                <label className="editor-meta-select editor-music-select">
                    <span className="sr-only">Background music</span>
                    <Select aria-label="Background music" value={isAvailableMusic(level.meta.music) ? level.meta.music : AVAILABLE_MUSIC[0]} onChange={(e) => setMeta({ music: e.target.value })}>
                        {AVAILABLE_MUSIC.map((track) => <option key={track} value={track}>{track.replace('_', ' · ').toUpperCase()}</option>)}
                    </Select>
                </label>
                <label className="editor-meta-select editor-template-select">
                    <span className="sr-only">New from template</span>
                    <Select aria-label="New from template" value="" onChange={(e) => { if (e.target.value) loadLevel(createTemplate(e.target.value as LevelTemplateId)); }}>
                        <option value="">New from template…</option>
                        {LEVEL_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.description}</option>)}
                    </Select>
                </label>
                <span className="save-state" aria-live="polite">
                    <Check size={15} aria-hidden /> {savedAt ? `Saved ${timeAgo(savedAt)}` : 'Autosave on'}
                </span>
                {cleared && (
                    <span className="clear-state">
                        <CheckCircle2 size={15} aria-hidden /> Cleared in {formatMs(clear!.timeMs)}
                    </span>
                )}
                <div className="editor-head-actions">
                    <Tooltip content="Export level.v1.json">
                        <button type="button" className="icon-btn" onClick={exportJson} aria-label="Export level as JSON">
                            <Download size={18} />
                        </button>
                    </Tooltip>
                    <Tooltip content="Import level.v1.json">
                        <button type="button" className="icon-btn" onClick={() => fileInput.current?.click()} aria-label="Import level from JSON">
                            <Upload size={18} />
                        </button>
                    </Tooltip>
                    <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importJson(e.target.files[0]).finally(() => (e.target.value = ''))} />
                    <Tooltip content="Keyboard shortcuts" shortcut="?">
                        <button type="button" className="icon-btn" onClick={() => setShortcuts(true)} aria-label="Show keyboard shortcuts">
                            <Keyboard size={18} />
                        </button>
                    </Tooltip>
                    <Button variant={testing ? 'outline-gold' : 'primary'} icon={testing ? <Pencil size={16} aria-hidden /> : <Play size={16} aria-hidden fill="currentColor" />} onClick={toggleTest} aria-pressed={testing}>
                        {testing ? 'Back to edit (T)' : 'Test Play (T)'}
                    </Button>
                    <Button variant="gold" icon={<Rocket size={16} aria-hidden />} onClick={() => setPublishing(true)} disabled={testing}>
                        Publish
                    </Button>
                </div>
            </div>

            {remix.parentId > 0 && (
                <div className={cx('remix-banner', remix.unchanged && 'is-unchanged')} role="status">
                    {remix.unchanged ? <AlertTriangle size={15} aria-hidden /> : <GitFork size={15} aria-hidden />}
                    <span>
                        Remix of{' '}
                        <Link to={`/level/${remix.parentId}`}>
                            #{remix.parentId}
                            {remix.known ? ` ${remixSource!.name}` : ''}
                        </Link>
                        {remix.unchanged
                            ? '. Change something before publishing: the layout is still identical to the original, and each layout can only be minted once.'
                            : remix.known
                              ? '. Layout changed: clear it from spawn, then publish it as a child LevelNFT.'
                              : '. Publishing mints a child LevelNFT; its layout must differ from the original.'}
                    </span>
                    <Button size="sm" variant="ghost" onClick={detachRemix} disabled={testing} title="Publish as an original level instead (parentId 0)">
                        Make it an original
                    </Button>
                </div>
            )}

            <div className="toolbar" role="toolbar" aria-label="Editor tools">
                <div className="tool-group" role="group" aria-label="Tools">
                    {TOOLS.map((t) => (
                        <Tooltip key={t.id} content={t.hint} shortcut={t.key}>
                            <button type="button" className={cx('tool', status.tool === t.id && 'is-active')} aria-pressed={status.tool === t.id} onClick={() => EventBus.emit('editor:set-tool', t.id)} disabled={testing}>
                                {t.icon}
                                <span>{t.label}</span>
                            </button>
                        </Tooltip>
                    ))}
                </div>
                <span className="tool-sep" aria-hidden />
                <div className="tool-group" role="group" aria-label="History">
                    <Tooltip content="Undo" shortcut="⌘Z">
                        <button type="button" className="tool" disabled={!status.canUndo || testing} onClick={() => EventBus.emit('editor:undo')}>
                            <Undo2 size={16} aria-hidden />
                            <span>Undo</span>
                        </button>
                    </Tooltip>
                    <Tooltip content="Redo" shortcut="⇧⌘Z">
                        <button type="button" className="tool" disabled={!status.canRedo || testing} onClick={() => EventBus.emit('editor:redo')}>
                            <Redo2 size={16} aria-hidden />
                            <span>Redo</span>
                        </button>
                    </Tooltip>
                </div>
                <div className="tool-group" role="group" aria-label="Selection transforms">
                    <Tooltip content="Rotate direction"><button type="button" className="tool tool-icon" aria-label="Rotate direction" onClick={() => EventBus.emit('editor:rotate', 1)} disabled={!selection || !ELEMENT_BY_TYPE[selection.type].props.some((p) => p.key === 'direction') || testing}><RotateCcw size={16} /></button></Tooltip>
                    <Tooltip content="Flip direction"><button type="button" className="tool tool-icon" aria-label="Flip direction" onClick={() => EventBus.emit('editor:flip')} disabled={!selection || !ELEMENT_BY_TYPE[selection.type].props.some((p) => p.key === 'direction') || testing}><FlipHorizontal size={16} /></button></Tooltip>
                </div>
                <div className="tool-group tool-group-end" role="group" aria-label="View">
                    <Tooltip content="Toggle grid" shortcut="G">
                        <button type="button" className={cx('tool', status.grid && 'is-active')} aria-pressed={status.grid} onClick={() => EventBus.emit('editor:toggle-grid')} disabled={testing}>
                            <Grid3x3 size={16} aria-hidden />
                            <span>Grid {status.grid ? 'on' : 'off'}</span>
                        </button>
                    </Tooltip>
                    <span className="zoom" role="group" aria-label="Zoom">
                        <button type="button" className="tool tool-icon" aria-label="Zoom out" onClick={() => EventBus.emit('editor:zoom', Math.max(0.25, status.zoom - 0.1))} disabled={testing}>
                            <ZoomOut size={16} />
                        </button>
                        <span className="zoom-val" aria-live="polite">
                            {Math.round(status.zoom * 100)}%
                        </span>
                        <button type="button" className="tool tool-icon" aria-label="Zoom in" onClick={() => EventBus.emit('editor:zoom', status.zoom + 0.1)} disabled={testing}>
                            <ZoomIn size={16} />
                        </button>
                    </span>
                </div>
            </div>

            <p className="editor-narrow-note">
                <Info size={15} aria-hidden /> The element palette and property panel need a wider screen (tablet landscape or desktop). You can still test-play, undo and publish here.
            </p>

            <div className="editor-body">
                <Palette selected={status.element} disabled={testing} />
                <div className="canvas-wrap">
                    <span className={cx('mode-badge', testing ? 'is-test' : status.tool === 'link' ? 'is-link' : '')} role="status">
                        {testing ? (
                            <>
                                <Play size={12} aria-hidden fill="currentColor" /> Test play · press T to edit
                            </>
                        ) : status.tool === 'link' ? (
                            <>
                                <Link2 size={12} aria-hidden /> Link mode · click source, then target
                            </>
                        ) : (
                            <>
                                <MousePointer2 size={12} aria-hidden /> Edit mode
                            </>
                        )}
                    </span>
                    {remixLoad?.stage === 'error' ? (
                        <div className="remix-loading">
                            <EmptyState tone="error" title={`Level #${remixLoad.id} could not be copied`} action={<><Button to={`/level/${remixLoad.id}`}>Back to the level</Button><Button variant="primary" onClick={cancelRemix}>Open my draft</Button></>}>
                                {remixLoad.error}
                            </EmptyState>
                        </div>
                    ) : remixLoad ? (
                        <div className="remix-loading">
                            <Spinner size={24} label={`Copying level #${remixLoad.id}`} />
                        </div>
                    ) : (
                        <PhaserGame scene={SCENES.Editor} data={{ level }} />
                    )}
                </div>
                <PropertiesPanel entity={testing ? null : selection} testing={testing} />
            </div>

            <div className="statusbar">
                <span>
                    {THEME_ICON[level.meta.theme]} {capitalize(level.meta.theme)} · {level.size.w} × {level.size.h} tiles · {level.entities.length} elements
                </span>
                <span className="num">{status.cursor ? `x ${status.cursor.x} · y ${status.cursor.y}` : ''}</span>
                <span className="statusbar-end">
                    <button type="button" className="link-btn" onClick={() => setShortcuts(true)}>
                        <Kbd>?</Kbd> Shortcuts
                    </button>
                    <span>
                        <Kbd>T</Kbd> {testing ? 'Back to edit' : 'Test play'}
                    </span>
                </span>
            </div>

            <Modal open={shortcuts} onClose={() => setShortcuts(false)} title="Keyboard shortcuts" icon={<Keyboard size={20} />} size="sm">
                <ul className="shortcut-list">
                    {SHORTCUTS.map(([keys, label]) => (
                        <li key={label}>
                            <span className="keys">
                                {keys.map((k) => (
                                    <Kbd key={k}>{k}</Kbd>
                                ))}
                            </span>
                            <span>{label}</span>
                        </li>
                    ))}
                </ul>
            </Modal>

            <Modal
                open={remixLoad?.stage === 'confirm'}
                onClose={cancelRemix}
                title={`Remix level #${remixLoad?.id ?? ''}?`}
                icon={<GitFork size={20} />}
                size="sm"
                footer={
                    <>
                        <Button onClick={cancelRemix}>Keep my draft</Button>
                        <Button variant="primary" onClick={() => remixLoad?.stage === 'confirm' && startRemix(remixLoad.file, remixLoad.source)}>
                            Replace and remix
                        </Button>
                    </>
                }
            >
                <p>
                    The remix replaces your current draft “{level.meta.name}”. Keep your draft and export it first (download icon) if you want to come back to it.
                </p>
            </Modal>

            {publishing && (
                <PublishModal
                    level={level}
                    remixSource={remixSource}
                    clear={clear}
                    onClose={() => setPublishing(false)}
                    onTestPlay={() => {
                        setPublishing(false);
                        toggleTest();
                    }}
                />
            )}
        </div>
    );
}
