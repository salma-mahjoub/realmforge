import Phaser from 'phaser';
import { EventBus, type EditorStatus, type EditorTool } from '../EventBus';
import { REG, SCENES, THEME_SKY, TILE } from '../constants';
import { ELEMENT_BY_TYPE, isTerrain } from '../level/catalog';
import { decodeLevel, encodeLevel } from '../level/serialize';
import { SAMPLE_LEVEL, loadAutosave, saveAutosave } from '../level';
import { TERRAIN_BY_ID, TERRAIN_IDS, type ElementType, type EntityProps, type LevelDoc, type LevelEntity, type LevelFileV1 } from '../level/types';
import {
    AddEntityCommand,
    CommandStack,
    CompositeCommand,
    MoveEntityCommand,
    RemoveEntityCommand,
    SetTilesCommand,
    UpdatePropsCommand,
    type EditorModel,
    type TileChange,
} from '../editor/commands';
import { elementTexture } from '../assets/registry';

export interface EditorSceneData {
    level?: LevelFileV1;
    /** Coming back from test-play: ignore `level` (Phaser keeps stale scene data) and resume. */
    resume?: boolean;
}

/**
 * Level editor (SPEC §3.3): grid rendering, place/erase/select/link tools, undo/redo command
 * stack (100 steps), localStorage autosave, `T` toggles test-play from the cursor position.
 */
export class EditorScene extends Phaser.Scene implements EditorModel {
    private doc!: LevelDoc;
    private stack!: CommandStack;
    private tool: EditorTool = 'place';
    private element: ElementType = 'ground';
    private gridVisible = true;
    private dirty = false;

    private tiles = new Map<number, Phaser.GameObjects.Image>();
    private entitySprites = new Map<number, Phaser.GameObjects.Image>();
    private grid!: Phaser.GameObjects.TileSprite;
    private overlay!: Phaser.GameObjects.Graphics;
    private cursorBox!: Phaser.GameObjects.Rectangle;

    private stroke: Map<number, TileChange> | null = null;
    private selectedId: number | null = null;
    private dragFrom: { x: number; y: number } | null = null;
    private linkFrom: number | null = null;
    private cursor: { x: number; y: number } | null = null;
    private panning: { x: number; y: number; sx: number; sy: number } | null = null;
    private autosaveTimer?: Phaser.Time.TimerEvent;
    private unsubs: Array<() => void> = [];

    constructor() {
        super(SCENES.Editor);
    }

    init(data: EditorSceneData) {
        const fresh = !data?.resume && data?.level;
        const file = (fresh ? data.level : undefined) ?? (this.registry.get(REG.editorLevel) as LevelFileV1 | undefined) ?? loadAutosave() ?? SAMPLE_LEVEL;
        this.doc = decodeLevel(file);
        this.stack = (this.registry.get(REG.editorStack) as CommandStack | undefined) ?? new CommandStack(100);
        if (fresh) this.stack.clear();
        this.registry.set(REG.editorStack, this.stack);
        this.tiles.clear();
        this.entitySprites.clear();
        this.selectedId = null;
        this.linkFrom = null;
    }

    create() {
        const { w, h } = this.doc.size;
        const cam = this.cameras.main;
        cam.setBackgroundColor(THEME_SKY[this.doc.meta.theme]);
        cam.setBounds(-TILE * 2, -TILE * 2, (w + 4) * TILE, (h + 4) * TILE);
        this.fitCamera();
        this.scale.on(Phaser.Scale.Events.RESIZE, this.fitCamera, this);

        this.grid = this.add.tileSprite(0, 0, w * TILE, h * TILE, 'ph:grid').setOrigin(0).setDepth(5);
        this.add.rectangle(0, 0, w * TILE, h * TILE).setOrigin(0).setStrokeStyle(4, 0x7c5cff, 0.9).setDepth(6);
        this.overlay = this.add.graphics().setDepth(20);
        this.cursorBox = this.add.rectangle(0, 0, TILE, TILE).setOrigin(0).setStrokeStyle(3, 0xffc83d).setDepth(30).setVisible(false);

        this.renderAll();
        this.bindInput();
        this.bindBus();

        this.autosaveTimer = this.time.addEvent({ delay: 2000, loop: true, callback: () => this.flushAutosave() });
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
        this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());

        this.emitStatus();
        this.emitLevel();
        EventBus.emit('current-scene-ready', this);
    }

    /** Fit the level height into the viewport and show the spawn area, bottom-aligned. */
    private fitCamera() {
        const cam = this.cameras.main;
        const { w, h } = this.doc.size;
        const vh = this.scale.height || 540;
        cam.setZoom(Phaser.Math.Clamp(vh / ((h + 1) * TILE), 0.15, 1));
        const viewW = this.scale.width / cam.zoom;
        cam.centerOn(Math.min(this.doc.spawn.x * TILE + viewW / 2 - TILE * 2, w * TILE - viewW / 2 + TILE), (h * TILE) / 2);
        this.emitStatus();
    }

    // ── EditorModel ────────────────────────────────────────────────────────────────────────────
    getTile(x: number, y: number) {
        if (!this.inBounds(x, y)) return 0;
        return this.doc.terrain[y * this.doc.size.w + x];
    }

    setTile(x: number, y: number, value: number) {
        if (!this.inBounds(x, y)) return;
        const idx = y * this.doc.size.w + x;
        this.doc.terrain[idx] = value;
        this.renderTile(idx);
        this.markDirty();
    }

    getEntity(id: number) {
        return this.doc.entities.find((e) => e.id === id);
    }

    addEntity(entity: LevelEntity) {
        this.doc.entities.push(entity);
        this.renderEntity(entity);
        this.syncFlow(entity);
        this.markDirty();
    }

    removeEntity(id: number) {
        this.doc.entities = this.doc.entities.filter((e) => e.id !== id);
        this.entitySprites.get(id)?.destroy();
        this.entitySprites.delete(id);
        if (this.selectedId === id) this.select(null);
        this.markDirty();
    }

    moveEntity(id: number, x: number, y: number) {
        const e = this.getEntity(id);
        if (!e) return;
        e.x = x;
        e.y = y;
        this.renderEntity(e);
        this.syncFlow(e);
        this.markDirty();
    }

    setEntityProps(id: number, props: EntityProps | undefined) {
        const e = this.getEntity(id);
        if (!e) return;
        e.props = props;
        this.renderEntity(e);
        if (this.selectedId === id) EventBus.emit('editor:selection', structuredClone(e));
        this.markDirty();
    }

    // ── rendering ──────────────────────────────────────────────────────────────────────────────
    private renderAll() {
        this.tiles.forEach((t) => t.destroy());
        this.tiles.clear();
        for (let i = 0; i < this.doc.terrain.length; i++) if (this.doc.terrain[i]) this.renderTile(i);
        this.entitySprites.forEach((s) => s.destroy());
        this.entitySprites.clear();
        this.doc.entities.forEach((e) => this.renderEntity(e));
        this.drawOverlay();
    }

    private renderTile(idx: number) {
        const v = this.doc.terrain[idx];
        const existing = this.tiles.get(idx);
        existing?.destroy();
        this.tiles.delete(idx);
        const type = TERRAIN_BY_ID[v];
        if (!type) return;
        const x = (idx % this.doc.size.w) * TILE;
        const y = Math.floor(idx / this.doc.size.w) * TILE;
        const tex = elementTexture(type, this.doc.meta.theme);
        this.tiles.set(idx, this.add.image(x, y, tex.key, tex.frame).setOrigin(0).setDisplaySize(TILE, TILE).setDepth(1));
    }

    private renderEntity(e: LevelEntity) {
        this.entitySprites.get(e.id)?.destroy();
        const def = ELEMENT_BY_TYPE[e.type];
        const w = ((e.props?.length as number | undefined) && (e.type === 'seesaw' || e.type === 'chain_bridge') ? (e.props!.length as number) : def?.w ?? 1) * TILE;
        const h = (def?.h ?? 1) * TILE;
        const tex = elementTexture(e.type, this.doc.meta.theme);
        const img = this.add
            .image(e.x * TILE, (e.y + 1) * TILE, tex.key, tex.frame)
            .setOrigin(0, 1)
            .setDisplaySize(w, h)
            .setDepth(10)
            .setAngle(Number(e.props?.rotation ?? 0));
        if (e.id === this.selectedId) img.setTint(0xd9ccff);
        this.entitySprites.set(e.id, img);
        this.drawOverlay();
    }

    /** Link lines (door↔door, switch→blocks) and moving-platform paths, like the mockup. */
    private drawOverlay() {
        if (!this.overlay) return;
        const g = this.overlay.clear();
        const c = (p: { x: number; y: number }) => ({ x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 });
        for (const e of this.doc.entities) {
            const link = e.props?.link;
            if (typeof link === 'number') {
                const t = this.getEntity(link);
                if (t) {
                    const a = c(e);
                    const b = c(t);
                    g.lineStyle(3, 0xffc83d, 0.9).lineBetween(a.x, a.y, b.x, b.y);
                    g.fillStyle(0xffc83d, 1).fillCircle(b.x, b.y, 6);
                }
            }
            const path = e.props?.path;
            if (Array.isArray(path) && path.length) {
                let prev = c(e);
                path.forEach((p, i) => {
                    const q = c(p);
                    g.lineStyle(3, 0x7c5cff, 0.9).lineBetween(prev.x, prev.y, q.x, q.y);
                    g.fillStyle(0x7c5cff, 1).fillCircle(q.x, q.y, 12);
                    g.fillStyle(0xffffff, 1).fillCircle(q.x, q.y, 4 + (i % 2));
                    prev = q;
                });
            }
        }
        if (this.selectedId !== null) {
            const s = this.entitySprites.get(this.selectedId);
            if (s) {
                const b = s.getBounds();
                g.lineStyle(3, 0x7c5cff, 1).strokeRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8);
            }
        }
        if (this.linkFrom !== null) {
            const src = this.getEntity(this.linkFrom);
            if (src && this.cursor) {
                const a = c(src);
                const b = c(this.cursor);
                g.lineStyle(2, 0xffc83d, 0.6).lineBetween(a.x, a.y, b.x, b.y);
            }
        }
    }

    // ── input ──────────────────────────────────────────────────────────────────────────────────
    private bindInput() {
        this.input.mouse?.disableContextMenu();

        this.input.on(Phaser.Input.Events.POINTER_DOWN, (p: Phaser.Input.Pointer) => {
            if (p.rightButtonDown() || p.middleButtonDown()) {
                const cam = this.cameras.main;
                this.panning = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY };
                return;
            }
            const cell = this.cellAt(p);
            if (!cell) return;
            this.onPrimaryDown(cell);
        });

        this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
            if (this.panning) {
                const cam = this.cameras.main;
                cam.setScroll(this.panning.sx - (p.x - this.panning.x) / cam.zoom, this.panning.sy - (p.y - this.panning.y) / cam.zoom);
                return;
            }
            const cell = this.cellAt(p);
            this.cursor = cell;
            this.cursorBox.setVisible(Boolean(cell));
            if (cell) this.cursorBox.setPosition(cell.x * TILE, cell.y * TILE);
            if (p.isDown && cell) this.onPrimaryDrag(cell);
            if (this.linkFrom !== null) this.drawOverlay();
        });

        this.input.on(Phaser.Input.Events.POINTER_UP, () => {
            this.panning = null;
            this.endStroke();
        });
        this.input.on(Phaser.Input.Events.GAME_OUT, () => {
            this.cursorBox.setVisible(false);
            this.endStroke();
        });

        this.input.on(Phaser.Input.Events.POINTER_WHEEL, (_p: Phaser.Input.Pointer, _o: unknown, dx: number, dy: number) => {
            const cam = this.cameras.main;
            cam.scrollX += (dx + dy) / cam.zoom;
        });

        const kb = this.input.keyboard;
        if (!kb) return;
        const guard = (fn: () => void) => () => {
            if (isTypingInForm()) return;
            fn();
        };
        kb.on('keydown-T', guard(() => this.toggleTestPlay()));
        kb.on('keydown-Z', (e: KeyboardEvent) => {
            if (isTypingInForm() || !(e.ctrlKey || e.metaKey)) return;
            if (e.shiftKey) this.redo();
            else this.undo();
        });
        kb.on('keydown-Y', (e: KeyboardEvent) => {
            if (!isTypingInForm() && (e.ctrlKey || e.metaKey)) this.redo();
        });
        kb.on('keydown-DELETE', guard(() => this.deleteSelected()));
        kb.on('keydown-BACKSPACE', guard(() => this.deleteSelected()));
        kb.on('keydown-ONE', guard(() => this.setTool('place')));
        kb.on('keydown-TWO', guard(() => this.setTool('erase')));
        kb.on('keydown-THREE', guard(() => this.setTool('select')));
        kb.on('keydown-FOUR', guard(() => this.setTool('link')));
        kb.on('keydown-G', guard(() => this.toggleGrid()));
        kb.on('keydown-ESC', guard(() => {
            this.linkFrom = null;
            this.select(null);
        }));
        this.cursorKeys = kb.createCursorKeys();
    }

    private cursorKeys?: Phaser.Types.Input.Keyboard.CursorKeys;

    update(_time: number, delta: number) {
        const k = this.cursorKeys;
        if (!k || isTypingInForm()) return;
        const cam = this.cameras.main;
        const speed = (delta * 0.9) / cam.zoom;
        if (k.left.isDown) cam.scrollX -= speed;
        if (k.right.isDown) cam.scrollX += speed;
        if (k.up.isDown) cam.scrollY -= speed;
        if (k.down.isDown) cam.scrollY += speed;
    }

    private onPrimaryDown(cell: { x: number; y: number }) {
        switch (this.tool) {
            case 'place':
                if (isTerrain(this.element)) {
                    this.stroke = new Map();
                    this.paint(cell, TERRAIN_IDS[this.element as keyof typeof TERRAIN_IDS]);
                } else {
                    this.placeEntity(cell);
                }
                break;
            case 'erase': {
                const hit = this.entityAt(cell);
                if (hit) this.stack.execute(new RemoveEntityCommand(structuredClone(hit)), this);
                else {
                    this.stroke = new Map();
                    this.paint(cell, 0);
                }
                break;
            }
            case 'select': {
                const hit = this.entityAt(cell);
                this.select(hit?.id ?? null);
                this.dragFrom = hit ? { x: hit.x, y: hit.y } : null;
                break;
            }
            case 'link':
                this.handleLinkClick(cell);
                break;
        }
        this.emitStatus();
    }

    private onPrimaryDrag(cell: { x: number; y: number }) {
        if (this.stroke) {
            this.paint(cell, this.tool === 'erase' ? 0 : TERRAIN_IDS[this.element as keyof typeof TERRAIN_IDS] ?? 0);
        } else if (this.tool === 'select' && this.selectedId !== null && this.dragFrom) {
            const e = this.getEntity(this.selectedId);
            if (e && (e.x !== cell.x || e.y !== cell.y)) this.moveEntity(e.id, cell.x, cell.y);
        }
    }

    private endStroke() {
        if (this.stroke && this.stroke.size) {
            this.stack.push(new SetTilesCommand([...this.stroke.values()], this.tool === 'erase' ? 'Erase tiles' : 'Paint tiles'));
        }
        this.stroke = null;
        if (this.tool === 'select' && this.selectedId !== null && this.dragFrom) {
            const e = this.getEntity(this.selectedId);
            if (e && (e.x !== this.dragFrom.x || e.y !== this.dragFrom.y)) {
                this.stack.push(new MoveEntityCommand(e.id, this.dragFrom, { x: e.x, y: e.y }));
            }
        }
        this.dragFrom = null;
        this.emitStatus();
    }

    private paint(cell: { x: number; y: number }, value: number) {
        if (!this.stroke) return;
        const idx = cell.y * this.doc.size.w + cell.x;
        const from = this.stroke.get(idx)?.from ?? this.getTile(cell.x, cell.y);
        if (this.getTile(cell.x, cell.y) === value) return;
        this.stroke.set(idx, { x: cell.x, y: cell.y, from, to: value });
        this.setTile(cell.x, cell.y, value);
    }

    private placeEntity(cell: { x: number; y: number }) {
        const type = this.element;
        const def = ELEMENT_BY_TYPE[type];
        if (this.entityAt(cell)) return;
        if (def.unique) {
            const existing = this.doc.entities.find((e) => e.type === type);
            if (existing) {
                this.stack.execute(new MoveEntityCommand(existing.id, { x: existing.x, y: existing.y }, cell), this);
                return;
            }
        }
        const id = this.doc.entities.reduce((m, e) => Math.max(m, e.id), 0) + 1;
        const entity: LevelEntity = { id, type: type as LevelEntity['type'], x: cell.x, y: cell.y };
        if (def.defaults) entity.props = structuredClone(def.defaults);
        this.stack.execute(new AddEntityCommand(entity), this);
        this.select(id);
    }

    private handleLinkClick(cell: { x: number; y: number }) {
        const hit = this.entityAt(cell);
        if (!hit) {
            this.linkFrom = null;
            this.drawOverlay();
            return;
        }
        if (this.linkFrom === null) {
            const linkable = ELEMENT_BY_TYPE[hit.type]?.props?.some((p) => p.kind === 'link');
            if (linkable) this.linkFrom = hit.id;
            this.select(hit.id);
            return;
        }
        const src = this.getEntity(this.linkFrom);
        this.linkFrom = null;
        if (!src || src.id === hit.id) return;
        const cmds = [new UpdatePropsCommand(src.id, src.props, { ...src.props, link: hit.id })];
        // pairs are bidirectional (door↔door, pipe↔pipe)
        if ((src.type === 'door' || src.type === 'pipe') && hit.type === src.type) {
            cmds.push(new UpdatePropsCommand(hit.id, hit.props, { ...hit.props, link: src.id }));
        }
        this.stack.execute(new CompositeCommand('Link', cmds), this);
        this.drawOverlay();
    }

    // ── actions (also driven from React via EventBus) ─────────────────────────────────────────
    private setTool(tool: EditorTool) {
        this.tool = tool;
        this.linkFrom = null;
        this.emitStatus();
    }

    private undo() {
        this.stack.undo(this);
        this.emitStatus();
    }

    private redo() {
        this.stack.redo(this);
        this.emitStatus();
    }

    private deleteSelected() {
        const e = this.selectedId !== null ? this.getEntity(this.selectedId) : undefined;
        if (e) this.stack.execute(new RemoveEntityCommand(structuredClone(e)), this);
        this.emitStatus();
    }

    private toggleGrid() {
        this.gridVisible = !this.gridVisible;
        this.grid.setVisible(this.gridVisible);
        this.emitStatus();
    }

    private toggleTestPlay() {
        const level = this.snapshotLevel();
        this.registry.set(REG.editorLevel, level);
        saveAutosave(level);
        this.dirty = false;
        this.emitLevel(level);
        const spawn = this.cursor && this.getTile(this.cursor.x, this.cursor.y) === 0 ? this.cursor : undefined;
        this.scene.start(SCENES.Play, { level, levelId: null, from: 'editor', spawn });
    }

    private select(id: number | null) {
        const prev = this.selectedId;
        this.selectedId = id;
        if (prev !== null) this.entitySprites.get(prev)?.clearTint();
        if (id !== null) this.entitySprites.get(id)?.setTint(0xd9ccff);
        const e = id !== null ? this.getEntity(id) : undefined;
        EventBus.emit('editor:selection', e ? structuredClone(e) : null);
        this.drawOverlay();
    }

    private bindBus() {
        const u = this.unsubs;
        u.push(EventBus.subscribe('editor:set-tool', (t) => this.setTool(t)));
        u.push(
            EventBus.subscribe('editor:set-element', (t) => {
                this.element = t;
                if (this.tool !== 'place') this.tool = 'place';
                this.emitStatus();
            }),
        );
        u.push(EventBus.subscribe('editor:undo', () => this.undo()));
        u.push(EventBus.subscribe('editor:redo', () => this.redo()));
        u.push(EventBus.subscribe('editor:toggle-test', () => this.toggleTestPlay()));
        u.push(EventBus.subscribe('editor:toggle-grid', () => this.toggleGrid()));
        u.push(EventBus.subscribe('editor:delete-selected', () => this.deleteSelected()));
        u.push(
            EventBus.subscribe('editor:zoom', (z) => {
                this.cameras.main.setZoom(Phaser.Math.Clamp(z, 0.25, 2));
                this.emitStatus();
            }),
        );
        u.push(
            EventBus.subscribe('editor:update-props', ({ id, props }) => {
                const e = this.getEntity(id);
                if (e) this.stack.execute(new UpdatePropsCommand(id, e.props && structuredClone(e.props), props), this);
                this.emitStatus();
            }),
        );
        u.push(
            EventBus.subscribe('editor:load-level', (level) => {
                this.registry.set(REG.editorLevel, level);
                this.stack.clear();
                this.scene.restart({ level });
            }),
        );
        u.push(
            EventBus.subscribe('editor:request-snapshot', () => {
                this.game.renderer.snapshot((img) => {
                    if (img instanceof HTMLImageElement) EventBus.emit('editor:snapshot', img.src);
                });
            }),
        );
    }

    private teardown() {
        this.unsubs.forEach((u) => u());
        this.unsubs = [];
        this.scale.off(Phaser.Scale.Events.RESIZE, this.fitCamera, this);
        this.autosaveTimer?.remove();
        if (this.dirty) this.flushAutosave();
    }

    // ── helpers ────────────────────────────────────────────────────────────────────────────────
    private inBounds(x: number, y: number) {
        return x >= 0 && y >= 0 && x < this.doc.size.w && y < this.doc.size.h;
    }

    private cellAt(p: Phaser.Input.Pointer): { x: number; y: number } | null {
        const wp = this.cameras.main.getWorldPoint(p.x, p.y);
        const x = Math.floor(wp.x / TILE);
        const y = Math.floor(wp.y / TILE);
        return this.inBounds(x, y) ? { x, y } : null;
    }

    private entityAt(cell: { x: number; y: number }): LevelEntity | undefined {
        // topmost first
        for (let i = this.doc.entities.length - 1; i >= 0; i--) {
            const e = this.doc.entities[i];
            const def = ELEMENT_BY_TYPE[e.type];
            const w = def?.w ?? 1;
            const h = def?.h ?? 1;
            if (cell.x >= e.x && cell.x < e.x + w && cell.y <= e.y && cell.y > e.y - h) return e;
        }
        return undefined;
    }

    private syncFlow(e: LevelEntity) {
        if (e.type === 'start') this.doc.spawn = { x: e.x, y: e.y };
        if (e.type === 'goal') this.doc.goal = { x: e.x, y: e.y };
    }

    private markDirty() {
        this.dirty = true;
    }

    private snapshotLevel(): LevelFileV1 {
        return encodeLevel(this.doc);
    }

    private flushAutosave() {
        if (!this.dirty) return;
        this.dirty = false;
        const level = this.snapshotLevel();
        this.registry.set(REG.editorLevel, level);
        saveAutosave(level);
        this.emitLevel(level);
    }

    private emitLevel(level = this.snapshotLevel()) {
        EventBus.emit('editor:level-changed', level);
    }

    private emitStatus() {
        const status: EditorStatus = {
            tool: this.tool,
            element: this.element,
            mode: 'edit',
            canUndo: this.stack.canUndo,
            canRedo: this.stack.canRedo,
            zoom: this.cameras.main?.zoom ?? 1,
            grid: this.gridVisible,
            cursor: this.cursor,
            dirty: this.dirty,
        };
        EventBus.emit('editor:status', status);
    }
}

function isTypingInForm(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}
