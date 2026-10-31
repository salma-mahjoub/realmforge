import Phaser from 'phaser';
import {
    COLLISION_CATEGORIES,
    EMPTY_INPUT,
    MOVEMENT,
    MovementState,
    createControllerState,
    createElementRuntime,
    createMatterPlayer,
    createReplay,
    installFixedMatterClock,
    inventoryFor,
    recordInput,
    SUBPIXEL,
    type ElementInstance,
    type InputState,
    type Replay,
} from '@realmforge/game-core';
import { EventBus } from '../EventBus';
import { REG, SCENES, SIM_HZ, STEP_MS, THEME_SKY, TILE } from '../constants';
import { decodeLevel } from '../level/serialize';
import { SAMPLE_LEVEL } from '../level';
import { TERRAIN_BY_ID, type LevelDoc, type LevelFileV1, type Waypoint } from '../level/types';
import { elementTexture, groundTexture, hasSfx, isPixelArt } from '../assets/registry';
import { drawMechanisms } from '../render/mechanisms';
import { createBackground } from '../render/background';
import { coreTextures, terrainDef, toCoreDef } from '../elements/bridge';
import { TRACE_STRIDE, changePairs, encodeInputLog, type RunSubmission, type TraceSample } from '../run';

export interface PlaySceneData {
    level?: LevelFileV1;
    levelId?: string | null;
    /** 'editor' enables the T key to go back to the editor. */
    from?: 'editor' | 'play' | 'race';
    /** Tile-space spawn override (test-play from cursor). */
    spawn?: Waypoint;
}

type MatterPlayer = ReturnType<typeof createMatterPlayer>;
type ElementRuntime = ReturnType<typeof createElementRuntime>;

/** Rendered character height (the controller hull is 12×15 reference px = 48×60 px at TILE 64). */
const PLAYER_DISPLAY_H = TILE * 15 / MOVEMENT.referenceTile;

const ANIM_FOR: Record<MovementState, string> = {
    idle: 'idle',
    walk: 'walk',
    run: 'run',
    skid: 'skid',
    jump: 'jump',
    fall: 'fall',
    crouch: 'crouch',
    wallSlide: 'wallSlide',
    dead: 'dead',
};

/**
 * Solo play (SPEC §3.5). Builds the level with game-core: terrain bodies + `createElementRuntime`
 * (all SPEC elements via `ELEMENTS[type].create`) + `createMatterPlayer` (Mario-like controller),
 * stepped by game-core's fixed 60 Hz Matter clock. Every physics step records one input mask
 * (game-core replay encoder), a position trace and checkpoint hits for server validation.
 */
export class PlayScene extends Phaser.Scene {
    protected file!: LevelFileV1;
    protected doc!: LevelDoc;
    protected levelId: string | null = null;
    protected from: PlaySceneData['from'] = 'play';
    protected player!: MatterPlayer;
    protected playerSprite!: Phaser.GameObjects.Sprite;
    protected runtime!: ElementRuntime;
    protected frame = 0;
    protected finished = false;
    protected paused = false;
    protected checkpointName: string | null = null;
    protected replay: Replay = createReplay();
    protected trace: TraceSample[] = [];
    protected checkpointHits: { id: number; f: number }[] = [];
    protected currentInput: InputState = EMPTY_INPUT;
    private respawnTile!: Waypoint;
    private spawnTile!: Waypoint;
    private goalReached = false;
    private anim = '';
    private playerTex = '';
    private keys!: Record<'left' | 'right' | 'up' | 'down' | 'a' | 'd' | 'w' | 's' | 'space' | 'z' | 'x' | 'shift', Phaser.Input.Keyboard.Key>;
    protected unsubs: Array<() => void> = [];

    private readonly scaleRef = TILE / MOVEMENT.referenceTile;

    constructor(key: string = SCENES.Play) {
        super({
            key,
            physics: {
                default: 'matter',
                matter: {
                    gravity: { x: 0, y: 2 },
                    // Stepped by game-core's installFixedMatterClock (exactly 1000/60 ms per step,
                    // accumulator-driven, render-rate independent); runner fps kept at 60 for consistency.
                    runner: { fps: SIM_HZ },
                    positionIterations: 8,
                    velocityIterations: 6,
                    debug: false,
                },
            },
        });
    }

    init(data: PlaySceneData) {
        const file = data?.level ?? (this.registry.get(REG.editorLevel) as LevelFileV1 | undefined) ?? SAMPLE_LEVEL;
        this.file = file;
        this.doc = decodeLevel(file);
        this.levelId = data?.levelId ?? null;
        this.from = data?.from ?? 'play';
        this.spawnTile = data?.spawn ?? this.doc.spawn;
        this.respawnTile = this.spawnTile;
        this.frame = 0;
        this.finished = false;
        this.paused = false;
        this.goalReached = false;
        this.checkpointName = null;
        this.replay = createReplay();
        this.trace = [];
        this.checkpointHits = [];
        this.currentInput = EMPTY_INPUT;
        this.anim = '';
    }

    create() {
        const { w, h } = this.doc.size;
        const W = w * TILE;
        const H = h * TILE;
        this.cameras.main.setBackgroundColor(THEME_SKY[this.doc.meta.theme]);
        this.cameras.main.setBounds(0, 0, W, H);
        // Side walls + ceiling, open bottom (falling out is a death). Walls must be "solid" for the player mask.
        this.matter.world.setBounds(0, -TILE * 4, W, H + TILE * 8, 64, true, true, true, false);
        for (const wall of Object.values(this.matter.world.walls)) {
            if (wall) wall.collisionFilter = { category: COLLISION_CATEGORIES.solid, mask: 0xffff, group: 0 };
        }

        createBackground(this, this.doc.meta.theme);
        this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

        // 1. Input sampling first: one mask per physics step, read by runtime + player.
        this.matter.world.on(Phaser.Physics.Matter.Events.BEFORE_UPDATE, this.fixedStep, this);
        // 2. Element runtime BEFORE the player (platform motion / one-way filtering precede contact queries).
        this.runtime = createElementRuntime(this, {
            tile: TILE,
            textures: coreTextures(this.doc.meta.theme),
            input: () => this.currentInput,
            onEvent: (type, el) => this.onElementEvent(type, el),
        });
        this.buildTerrain();
        for (const e of this.doc.entities) {
            if (e.type === 'start') continue;
            const def = toCoreDef(e);
            if (!def) {
                console.warn(`[PlayScene] unknown element type "${e.type}" (#${e.id}) skipped`);
                continue;
            }
            try {
                this.runtime.add(def);
            } catch (err) {
                console.warn(`[PlayScene] element #${e.id} (${e.type}) rejected:`, err);
            }
        }

        drawMechanisms(this, this.runtime.elements);

        // 3. game-core Mario-like controller on a Matter compound body.
        const sp = this.tileCenter(this.spawnTile);
        this.player = createMatterPlayer(this, sp.x, sp.y, {
            tile: TILE,
            input: () => this.currentInput,
            surface: this.runtime.surface,
            carry: this.runtime.carry,
        });
        this.runtime.attachPlayer(this.player);
        this.matter.world.on(Phaser.Physics.Matter.Events.AFTER_UPDATE, this.afterFixedStep, this);

        const tex = elementTexture('player');
        this.playerTex = tex.key;
        this.playerSprite = this.add.sprite(sp.x, sp.y, tex.key, tex.frame).setOrigin(0.5, 1).setDepth(50);
        this.playerSprite.setScale(PLAYER_DISPLAY_H / Math.max(1, this.playerSprite.height));
        this.syncSprite();

        // 4. Fixed 60 Hz clock shared by runtime + player (game-core accumulator).
        installFixedMatterClock(this);

        this.cameras.main.startFollow(this.playerSprite, isPixelArt(), 0.15, 0.15, 0, TILE);
        this.fitZoom();
        this.bindKeys();
        this.bindBus();
        this.trace.push(this.sample());

        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
        this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
        // Phaser registers Matter shutdown before create(). Let game-core dispose its visuals,
        // clock and bodies while the world still exists when switching scenes or restarting.
        const matter = this.matter as Phaser.Physics.Matter.MatterPhysics & { shutdown(): void };
        this.events.off(Phaser.Scenes.Events.SHUTDOWN, matter.shutdown, matter);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, matter.shutdown, matter);
        this.emitHud();
        if (import.meta.env.DEV) (window as unknown as { __play?: PlayScene }).__play = this;
        EventBus.emit('current-scene-ready', this);
    }

    /** BEFORE_UPDATE — once per 16.67 ms physics step. */
    protected fixedStep() {
        if (this.paused || this.finished) return;
        this.currentInput = this.readInput();
        recordInput(this.replay, this.currentInput);
    }

    /** AFTER_UPDATE — collision-resolved state of this step. */
    protected afterFixedStep() {
        if (this.paused || this.finished || !this.player) return;
        this.frame++;
        const y = this.player.body.position.y;
        if (this.player.state.mode === MovementState.dead || y > this.doc.size.h * TILE + TILE * 2) this.die();
        if (this.frame % TRACE_STRIDE === 0) this.trace.push(this.sample());
        if (this.goalReached) this.finish();
        if (this.frame % 6 === 0) this.emitHud();
        this.afterStep();
    }

    update() {
        // render-rate only: sprite + parallax (simulation runs in the fixed step)
        if (this.player) this.syncSprite();

    }

    private syncSprite() {
        const b = this.player.body;
        const hull = b.parts[1] ?? b;
        this.playerSprite.setPosition(hull.position.x, hull.bounds.max.y);
        const s = this.player.state;
        this.playerSprite.setFlipX(s.facing < 0);
        const name = ANIM_FOR[s.mode] ?? 'idle';
        if (name !== this.anim) {
            this.anim = name;
            const key = `${this.playerTex}:${name}`;
            const fallback = `${this.playerTex}:${s.mode === MovementState.dead || s.mode === MovementState.wallSlide ? 'fall' : 'idle'}`;
            if (this.anims.exists(key)) this.playerSprite.play(key, true);
            else if (this.anims.exists(fallback)) this.playerSprite.play(fallback, true);
        }
        // Frame dimensions can differ across poses: scale visible art after selecting the frame.
        const tex = elementTexture('player');
        const display = tex.displaySize;
        const height = hull.bounds.max.y - hull.bounds.min.y;
        const crouch = s.mode === MovementState.crouch ? 0.7 : 1;
        this.playerSprite.setDisplaySize(display ? height * display.w / display.h : TILE * 0.8, height * crouch);
        this.playerSprite.setOrigin(tex.anchor?.x ?? 0.5, tex.anchor?.y ?? 1);
        if (s.mode === MovementState.walk || s.mode === MovementState.run) this.playerSprite.anims.timeScale = Phaser.Math.Clamp(Math.abs(s.vx) / (SUBPIXEL * (s.mode === MovementState.run ? MOVEMENT.runMax : MOVEMENT.walkMax)), 0.45, 1.8);
        else this.playerSprite.anims.timeScale = 1;
    }

    /** Position in tile cell coordinates (same convention as level spawn/goal). */
    protected sample(): TraceSample {
        const p = this.player.body.position;
        const r = (v: number) => Math.round(v * 1000) / 1000;
        return { f: this.frame, x: r(p.x / TILE - 0.5), y: r(p.y / TILE - 0.5) };
    }

    private onResize() {
        this.fitZoom();
    }

    /** Keep about 22 tiles across; tall windows expose more vertical space. */
    private fitZoom() {
        const { width } = this.scale;
        const z = Phaser.Math.Clamp((width || 1280) / (22 * TILE), 0.35, 1.5);
        this.cameras.main.setZoom(z).setDeadzone(3 * TILE * z, 2 * TILE * z);
    }

    protected sfx(key: string) {
        if (hasSfx(`sfx:${key}`) && this.cache.audio.exists(`sfx:${key}`)) this.sound.play(`sfx:${key}`, { volume: 0.5 });
    }

    /** Hook for subclasses (RaceScene). */
    protected afterStep(): void {}

    get timeMs() {
        return Math.round(this.frame * STEP_MS);
    }

    get coins() {
        return this.player ? inventoryFor(this.player).coins : 0;
    }

    // ── world building ─────────────────────────────────────────────────────────────────────────
    /**
     * Ground runs become one merged static "solid" body per horizontal run (no seams, few bodies);
     * every other terrain tile (brick, question, ice, slime, one-way, semi-solid) is a game-core
     * element so it gets its behaviour (break, reward, surface, drop-through).
     */
    private buildTerrain() {
        const { w, h } = this.doc.size;
        const t = this.doc.terrain;
        const theme = this.doc.meta.theme;
        for (let y = 0; y < h; y++) {
            let x = 0;
            while (x < w) {
                const v = t[y * w + x];
                const type = TERRAIN_BY_ID[v];
                if (!type) {
                    x++;
                    continue;
                }
                if (type !== 'ground') {
                    try {
                        this.runtime.add(terrainDef(type, x, y));
                    } catch (err) {
                        console.warn(`[PlayScene] terrain ${type} at ${x},${y} rejected`, err);
                    }
                    x++;
                    continue;
                }
                let n = 1;
                while (x + n < w && t[y * w + x + n] === v) n++;
                for (let i = 0; i < n; i++) {
                    const tex = groundTexture(theme, t, w, h, x + i, y);
                    this.add.image((x + i) * TILE, y * TILE, tex.key, tex.frame).setOrigin(0).setDisplaySize(TILE, TILE);
                }
                this.matter.add.rectangle((x + n / 2) * TILE, y * TILE + TILE / 2, n * TILE, TILE, {
                    isStatic: true,
                    friction: 0.1,
                    label: 'ground',
                    collisionFilter: { category: COLLISION_CATEGORIES.solid, mask: 0xffff, group: 0 },
                });
                x += n;
            }
        }
    }

    /** Interactions reported by the game-core element runtime (afterupdate). */
    protected onElementEvent(type: string, el: ElementInstance) {
        switch (type) {
            case 'coin':
            case 'big_coin':
                this.sfx('coin');
                break;
            case 'spring':
                this.sfx('spring');
                break;
            case 'walker':
            case 'shell':
            case 'flyer':
            case 'jumper':
                if (this.player.state.mode !== MovementState.dead) this.sfx('stomp');
                break;
            case 'checkpoint': {
                const id = Number(el.def.id);
                const entity = this.doc.entities.find((e) => e.id === id);
                if (entity && !this.checkpointHits.some((c) => c.id === id)) {
                    this.checkpointHits.push({ id, f: this.frame });
                    this.respawnTile = { x: entity.x, y: entity.y };
                    this.checkpointName = `Checkpoint ${id}`;
                }
                break;
            }
            case 'goal':
                this.goalReached = true;
                break;
            default:
                break;
        }
        this.emitHud();
    }

    protected die() {
        // Show a death pose without delaying or changing the deterministic respawn.
        const ghost = this.add.sprite(this.playerSprite.x, this.playerSprite.y, this.playerTex, this.playerSprite.frame.name)
            .setOrigin(0.5, 1).setDisplaySize(this.playerSprite.displayWidth, this.playerSprite.displayHeight).setDepth(51).setFlipX(this.playerSprite.flipX);
        if (this.anims.exists(`${this.playerTex}:dead`)) ghost.play(`${this.playerTex}:dead`);
        this.tweens.add({ targets: ghost, y: ghost.y - TILE, alpha: 0, duration: 350, onComplete: () => ghost.destroy() });
        const cp = this.tileCenter(this.respawnTile);
        this.player.setState(createControllerState(cp.x / this.scaleRef, cp.y / this.scaleRef));
        this.cameras.main.flash(150, 255, 80, 80);
        this.sfx('death');
        EventBus.emit('play:died');
    }

    protected finish() {
        if (this.finished) return;
        this.finished = true;
        this.trace.push(this.sample());
        this.matter.world.pause();
        this.sfx('goal');
        this.emitHud();
        this.cameras.main.flash(250, 255, 200, 61);
        const run: RunSubmission = {
            timeMs: this.timeMs,
            cleared: true,
            coins: this.coins,
            trace: dedupeTrace(this.trace),
            checkpoints: [...this.checkpointHits],
            inputLog: encodeInputLog(this.replay),
        };
        EventBus.emit('play:finished', {
            levelId: this.levelId,
            timeMs: this.timeMs,
            coins: this.coins,
            cleared: true,
            inputs: changePairs(this.replay),
            fromSpawn: this.spawnTile.x === this.doc.spawn.x && this.spawnTile.y === this.doc.spawn.y,
            run,
        });
    }

    // ── input / bus ────────────────────────────────────────────────────────────────────────────
    private bindKeys() {
        const kb = this.input.keyboard;
        if (!kb) return;
        const K = Phaser.Input.Keyboard.KeyCodes;
        this.keys = kb.addKeys(
            { left: K.LEFT, right: K.RIGHT, up: K.UP, down: K.DOWN, a: K.A, d: K.D, w: K.W, s: K.S, space: K.SPACE, z: K.Z, x: K.X, shift: K.SHIFT },
            false,
        ) as typeof this.keys;
        kb.on('keydown-R', () => this.restart());
        kb.on('keydown-T', () => {
            if (this.from === 'editor') this.backToEditor();
        });
        kb.on('keydown-ESC', () => {
            if (this.from === 'editor') this.backToEditor();
        });
    }

    /** Up/W is "up" (doors, pipes, switches) — jump is Space/Z, as in game-core's lab. */
    protected readInput(): InputState {
        const k = this.keys;
        if (!k) return EMPTY_INPUT;
        return {
            left: k.left.isDown || k.a.isDown,
            right: k.right.isDown || k.d.isDown,
            up: k.up.isDown || k.w.isDown,
            down: k.down.isDown || k.s.isDown,
            jump: k.space.isDown || k.z.isDown,
            run: k.shift.isDown || k.x.isDown,
        };
    }

    protected bindBus() {
        this.unsubs.push(EventBus.subscribe('play:restart', () => this.restart()));
        this.unsubs.push(
            EventBus.subscribe('play:pause', (p) => {
                this.paused = p;
                if (p) this.matter.world.pause();
                else if (!this.finished) this.matter.world.resume();
            }),
        );
        this.unsubs.push(
            EventBus.subscribe('play:load-level', ({ levelId, level }) => this.scene.restart({ level, levelId, from: this.from })),
        );
        this.unsubs.push(
            EventBus.subscribe('editor:toggle-test', () => {
                if (this.from === 'editor') this.backToEditor();
            }),
        );
    }

    /** Return to the editor, resuming its registry copy + undo stack (not the stale boot data). */
    protected backToEditor() {
        this.scene.start(SCENES.Editor, { resume: true });
    }

    protected restart() {
        this.scene.restart({ level: this.file, levelId: this.levelId, from: this.from, spawn: this.spawnTile });
    }

    protected teardown() {
        this.unsubs.forEach((u) => u());
        this.unsubs = [];
        this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
        // Matter's SHUTDOWN handler may already have destroyed the world; game-core's player,
        // element runtime and fixed clock remove their own listeners on scene shutdown.
        const world = this.matter?.world;
        world?.off(Phaser.Physics.Matter.Events.BEFORE_UPDATE, this.fixedStep, this);
        world?.off(Phaser.Physics.Matter.Events.AFTER_UPDATE, this.afterFixedStep, this);
    }

    protected emitHud() {
        EventBus.emit('play:hud', { timeMs: this.timeMs, coins: this.coins, checkpoint: this.checkpointName });
    }

    protected tileCenter(p: Waypoint) {
        return { x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 };
    }
}

/** Trace frames must be strictly increasing. */
function dedupeTrace(trace: TraceSample[]): TraceSample[] {
    const out: TraceSample[] = [];
    for (const s of trace) if (!out.length || s.f > out[out.length - 1].f) out.push(s);
    return out;
}

export function formatTime(ms: number): string {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
