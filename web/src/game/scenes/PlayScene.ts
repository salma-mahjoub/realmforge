import Phaser from 'phaser';
import { EventBus } from '../EventBus';
import { REG, SCENES, SIM_HZ, STEP_MS, THEME_SKY, TILE } from '../constants';
import { ELEMENT_BY_TYPE, TERRAIN_FRICTION } from '../level/catalog';
import { decodeLevel } from '../level/serialize';
import { SAMPLE_LEVEL } from '../level';
import { TERRAIN_BY_ID, type LevelDoc, type LevelEntity, type LevelFileV1, type Waypoint } from '../level/types';
import { elementTexture, hasSfx, themeBackground } from '../assets/registry';
import { CATEGORY, EMPTY_INPUT, createPlayer, encodeButtons, type InputState, type PlayerHandle } from '../player/PlayerAdapter';

export interface PlaySceneData {
    level?: LevelFileV1;
    levelId?: string | null;
    /** 'editor' enables the T key to go back to the editor. */
    from?: 'editor' | 'play' | 'race';
    /** Tile-space spawn override (test-play from cursor). */
    spawn?: Waypoint;
}

/**
 * Solo play (SPEC §3.5). Builds a Matter world from a level file, runs the player at a fixed
 * 60 Hz step, records the input log (`frame, buttons`) and reports HUD + finish to React.
 *
 * TODO(elements): entity behaviour is a minimal stand-in. Replace `spawnEntity` with the
 * element factory from src/game/elements/ (owned by elements-runtime) once it lands.
 */
export class PlayScene extends Phaser.Scene {
    protected file!: LevelFileV1;
    protected doc!: LevelDoc;
    protected levelId: string | null = null;
    protected from: PlaySceneData['from'] = 'play';
    protected player!: PlayerHandle;
    protected frame = 0;
    protected finished = false;
    protected paused = false;
    protected coins = 0;
    protected checkpoint: Waypoint | null = null;
    protected checkpointName: string | null = null;
    protected inputLog: Array<[number, number]> = [];
    private lastButtons = -1;
    private spawnTile!: Waypoint;
    private keys!: Record<'left' | 'right' | 'up' | 'down' | 'a' | 'd' | 'w' | 's' | 'space' | 'z' | 'x' | 'shift', Phaser.Input.Keyboard.Key>;
    private sensorHandlers = new Map<number, { entity: LevelEntity; obj?: Phaser.GameObjects.GameObject }>();
    protected unsubs: Array<() => void> = [];
    private bg?: Phaser.GameObjects.TileSprite;

    constructor(key: string = SCENES.Play) {
        super({
            key,
            physics: {
                default: 'matter',
                matter: {
                    gravity: { x: 0, y: 2 },
                    // SPEC §3.1 fixed 60 Hz step. Phaser 3.90 bundles Matter 0.20, whose Runner is
                    // always a fixed-delta accumulator (the old `isFixed` flag no longer exists):
                    // `fps: 60` => every Engine.update advances exactly 1000/60 ms.
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
        this.frame = 0;
        this.finished = false;
        this.paused = false;
        this.coins = 0;
        this.checkpoint = null;
        this.checkpointName = null;
        this.inputLog = [];
        this.lastButtons = -1;
        this.sensorHandlers.clear();
    }

    create() {
        const { w, h } = this.doc.size;
        const W = w * TILE;
        const H = h * TILE;
        this.cameras.main.setBackgroundColor(THEME_SKY[this.doc.meta.theme]);
        this.cameras.main.setBounds(0, 0, W, H);
        // open bottom so falling out of the level is a death
        this.matter.world.setBounds(0, -TILE * 4, W, H + TILE * 8, 64, true, true, false, false);

        const bg = themeBackground(this.doc.meta.theme);
        if (bg) this.bg = this.add.tileSprite(0, 0, 1, 1, bg).setOrigin(0.5).setScrollFactor(0).setDepth(-10);
        this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

        this.buildTerrain();
        this.doc.entities.forEach((e) => this.spawnEntity(e));

        const sp = this.tileCenter(this.spawnTile);
        this.player = createPlayer(this, sp.x, sp.y - 8);
        this.cameras.main.startFollow(this.player.sprite, true, 0.15, 0.15, 0, TILE);
        this.fitZoom();

        this.matter.world.on('collisionstart', this.onCollision, this);
        // Drive the controller from the physics step (not the render frame) so one game frame
        // == one 60 Hz Matter step regardless of monitor refresh rate.
        this.matter.world.on(Phaser.Physics.Matter.Events.BEFORE_UPDATE, this.fixedStep, this);
        this.bindKeys();
        this.bindBus();

        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
        this.events.once(Phaser.Scenes.Events.DESTROY, () => this.teardown());
        this.emitHud();
        EventBus.emit('current-scene-ready', this);
    }

    protected fixedStep() {
        if (this.paused || this.finished) return;
        const input = this.readInput();
        const buttons = encodeButtons(input);
        if (buttons !== this.lastButtons) {
            this.inputLog.push([this.frame, buttons]);
            this.lastButtons = buttons;
        }
        this.player.step(input);
        this.frame++;

        if (this.player.sprite.y > this.doc.size.h * TILE + TILE * 2) this.die();
        if (this.frame % 6 === 0) this.emitHud();
        this.afterStep();
    }

    update() {
        // render-rate only: parallax background (simulation runs in fixedStep)
        if (this.bg) this.bg.tilePositionX = (this.cameras.main.scrollX * 0.3) / this.bg.tileScaleX;
    }

    private onResize() {
        this.fitZoom();
    }

    /** Show ~11 tiles vertically whatever the canvas size (HUD/labels live in React, not here). */
    private fitZoom() {
        const { width, height } = this.scale;
        const z = Phaser.Math.Clamp((height || 540) / (11 * TILE), 0.4, 1.25);
        this.cameras.main.setZoom(z);
        if (this.bg) {
            // scrollFactor-0 objects still scale with zoom around the viewport centre
            this.bg.setPosition(width / 2, height / 2).setSize(width / z, height / z);
            this.bg.setTileScale(height / z / this.bg.texture.getSourceImage().height);
        }
    }

    protected sfx(key: string) {
        if (hasSfx(`sfx:${key}`) && this.cache.audio.exists(`sfx:${key}`)) this.sound.play(`sfx:${key}`, { volume: 0.5 });
    }

    /** Hook for subclasses (RaceScene). */
    protected afterStep(): void {}

    get timeMs() {
        return Math.round(this.frame * STEP_MS);
    }

    // ── world building ─────────────────────────────────────────────────────────────────────────
    private buildTerrain() {
        const { w, h } = this.doc.size;
        const t = this.doc.terrain;
        for (let y = 0; y < h; y++) {
            let x = 0;
            while (x < w) {
                const v = t[y * w + x];
                if (!v) {
                    x++;
                    continue;
                }
                let n = 1;
                while (x + n < w && t[y * w + x + n] === v) n++;
                const type = TERRAIN_BY_ID[v];
                for (let i = 0; i < n; i++) {
                    const tex = elementTexture(type, this.doc.meta.theme);
                    this.add.image((x + i) * TILE, y * TILE, tex.key, tex.frame).setOrigin(0).setDisplaySize(TILE, TILE);
                }
                const oneway = type === 'oneway' || type === 'semisolid';
                // merged static body per horizontal run (fewer bodies, no seams)
                this.matter.add.rectangle((x + n / 2) * TILE, y * TILE + (oneway ? TILE * 0.15 : TILE / 2), n * TILE, oneway ? TILE * 0.3 : TILE, {
                    isStatic: true,
                    friction: TERRAIN_FRICTION[type] ?? 0.1,
                    label: `terrain:${type}`,
                    collisionFilter: { category: oneway ? CATEGORY.oneway : CATEGORY.solid, mask: 0xffff, group: 0 },
                });
                x += n;
            }
        }
    }

    protected spawnEntity(e: LevelEntity) {
        const def = ELEMENT_BY_TYPE[e.type];
        if (!def || e.type === 'start') return;
        const wTiles = (e.type === 'seesaw' || e.type === 'chain_bridge') && typeof e.props?.length === 'number' ? e.props.length : def.w ?? 1;
        const hTiles = def.h ?? 1;
        const cx = (e.x + wTiles / 2) * TILE;
        const cy = (e.y + 1 - hTiles / 2) * TILE;
        const tex = elementTexture(e.type, this.doc.meta.theme);

        const sensor = (category: number) => {
            const img = this.add.image(cx, cy, tex.key, tex.frame).setDisplaySize(wTiles * TILE, hTiles * TILE);
            const body = this.matter.add.rectangle(cx, cy, wTiles * TILE * 0.8, hTiles * TILE * 0.8, {
                isStatic: true,
                isSensor: true,
                label: `entity:${e.type}`,
                collisionFilter: { category, mask: CATEGORY.player, group: 0 },
            });
            this.sensorHandlers.set(body.id, { entity: e, obj: img });
        };

        switch (def.category) {
            case 'items':
                sensor(CATEGORY.pickup);
                return;
            case 'hazards':
                if (e.type === 'falling_block') break;
                sensor(CATEGORY.hazard);
                return;
            case 'flow':
                if (e.type === 'goal' || e.type === 'checkpoint') {
                    sensor(CATEGORY.sensor);
                    return;
                }
                break;
            case 'dynamic':
                if (e.type === 'spring') {
                    sensor(CATEGORY.sensor);
                    return;
                }
                if (e.type === 'crate') {
                    const img = this.matter.add.image(cx, cy, tex.key, tex.frame, { label: 'entity:crate', friction: 0.4, frictionAir: 0.02 });
                    img.setDisplaySize(TILE * 0.95, TILE * 0.95).setFixedRotation();
                    return;
                }
                break;
            default:
                break;
        }
        // Everything else: render + static solid stand-in until src/game/elements provides behaviour.
        this.add.image(cx, cy, tex.key, tex.frame).setDisplaySize(wTiles * TILE, hTiles * TILE);
        if (def.category !== 'enemies' && e.type !== 'door' && e.type !== 'pipe') {
            this.matter.add.rectangle(cx, cy, wTiles * TILE, hTiles * TILE * (e.type === 'seesaw' || e.type === 'chain_bridge' ? 0.25 : 1), {
                isStatic: true,
                label: `entity:${e.type}`,
            });
        }
    }

    private onCollision(ev: Phaser.Physics.Matter.Events.CollisionStartEvent) {
        for (const pair of ev.pairs) {
            const a = pair.bodyA as MatterJS.BodyType;
            const b = pair.bodyB as MatterJS.BodyType;
            const other = this.player.owns(a) ? b : this.player.owns(b) ? a : null;
            if (!other) continue;
            const hit = this.sensorHandlers.get(other.id);
            if (!hit) continue;
            this.onTouch(hit.entity, other, hit.obj);
        }
    }

    protected onTouch(e: LevelEntity, body: MatterJS.BodyType, obj?: Phaser.GameObjects.GameObject) {
        switch (e.type) {
            case 'coin':
            case 'big_coin':
                this.coins += e.type === 'big_coin' ? Number(e.props?.value ?? 10) : 1;
                this.sfx('coin');
                obj?.destroy();
                this.matter.world.remove(body);
                this.sensorHandlers.delete(body.id);
                break;
            case 'checkpoint':
                this.checkpoint = { x: e.x, y: e.y };
                this.checkpointName = `Checkpoint ${e.id}`;
                (obj as Phaser.GameObjects.Image | undefined)?.setTint(0xffc83d);
                break;
            case 'spring':
                this.player.launch(Number(e.props?.power ?? 1));
                this.sfx('spring');
                break;
            case 'goal':
                this.finish();
                break;
            case 'spikes':
            case 'lava':
            case 'saw':
                this.die();
                break;
            default:
                break;
        }
        this.emitHud();
    }

    protected die() {
        const cp = this.tileCenter(this.checkpoint ?? this.spawnTile);
        this.player.teleport(cp.x, cp.y - 8);
        this.cameras.main.flash(150, 255, 80, 80);
        this.sfx('death');
        EventBus.emit('play:died');
    }

    protected finish() {
        if (this.finished) return;
        this.finished = true;
        this.player.sprite.setVelocity(0, 0);
        this.matter.world.pause();
        this.sfx('goal');
        this.emitHud();
        this.cameras.main.flash(250, 255, 200, 61);
        EventBus.emit('play:finished', { levelId: this.levelId, timeMs: this.timeMs, coins: this.coins, cleared: true, inputs: this.inputLog });
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

    protected readInput(): InputState {
        const k = this.keys;
        if (!k) return EMPTY_INPUT;
        return {
            left: k.left.isDown || k.a.isDown,
            right: k.right.isDown || k.d.isDown,
            up: k.up.isDown || k.w.isDown,
            down: k.down.isDown || k.s.isDown,
            jump: k.space.isDown || k.z.isDown || k.up.isDown || k.w.isDown,
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
        // Matter's own SHUTDOWN handler may already have destroyed the world (listeners go with it);
        // input/keyboard plugins drop their listeners on shutdown by themselves.
        const world = this.matter?.world;
        world?.off('collisionstart', this.onCollision, this);
        world?.off(Phaser.Physics.Matter.Events.BEFORE_UPDATE, this.fixedStep, this);
        if (world) this.player?.destroy();
    }

    protected emitHud() {
        EventBus.emit('play:hud', { timeMs: this.timeMs, coins: this.coins, checkpoint: this.checkpointName });
    }

    protected tileCenter(p: Waypoint) {
        return { x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE / 2 };
    }
}

export function formatTime(ms: number): string {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const cs = Math.floor((ms % 1000) / 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
