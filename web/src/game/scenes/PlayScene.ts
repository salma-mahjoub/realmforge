import Phaser from 'phaser';
import {
    COLLISION_CATEGORIES,
    EMPTY_INPUT,
    MOVEMENT,
    MovementState,
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
import { EventBus, type PlayState } from '../EventBus';
import { REG, SCENES, SIM_HZ, STEP_MS, THEME_SKY, TILE } from '../constants';
import { decodeLevel } from '../level/serialize';
import { SAMPLE_LEVEL } from '../level';
import { TERRAIN_BY_ID, type LevelDoc, type LevelFileV1, type Waypoint } from '../level/types';
import { groundTexture, hasSfx, playerTexture } from '../assets/registry';
import { characterDisplay } from '../render/artwork';
import { drawMechanisms } from '../render/mechanisms';
import { createBackground } from '../render/background';
import { PlayerCameraTarget } from '../render/PlayerCameraTarget';
import { PlayEffects } from '../render/PlayEffects';
import { coreTextures, terrainDef, toCoreDef } from '../elements/bridge';
import { TRACE_STRIDE, changePairs, encodeInputLog, type RunSubmission, type TraceSample } from '../run';

export interface PlaySceneData {
    level?: LevelFileV1;
    levelId?: string | null;
    /** Optional creator label supplied by the React/indexer layer. */
    creator?: string;
    /** 'editor' enables the T key to go back to the editor. */
    from?: 'editor' | 'play' | 'race';
    /** Tile-space spawn override (test-play from cursor). */
    spawn?: Waypoint;
    /** Start playing at once, without the title card (a race restarts on the server's GO). */
    skipIntro?: boolean;
}

type MatterPlayer = ReturnType<typeof createMatterPlayer> & { form?: 'small' | 'big'; setForm?: (form: 'small' | 'big') => void; invulnerable?: boolean };
type PlayerOptions = NonNullable<Parameters<typeof createMatterPlayer>[3]> & { onFormChange?: (form: 'small' | 'big') => void };
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
    private cameraTarget!: PlayerCameraTarget;
    protected runtime!: ElementRuntime;
    protected frame = 0;
    protected finished = false;
    private skipIntro = false;
    protected paused = false;
    protected checkpointName: string | null = null;
    protected replay: Replay = createReplay();
    protected trace: TraceSample[] = [];
    protected checkpointHits: { id: number; f: number }[] = [];
    protected currentInput: InputState = EMPTY_INPUT;
    protected spawnTile!: Waypoint;
    private goalReached = false;
    private lastMissingWarning = -1000;
    protected creator?: string;
    private sequence: 'intro' | 'death' | 'dead' | 'goal' | null = null;
    private effects!: PlayEffects;
    private previousMode = MovementState.idle;
    private previousVy = 0;
    private squash = 0;
    private squashStart = 0;
    private facing = 1;
    private turnStart = -1000;
    private presentationMs = 0;
    private anim = '';
    private playerTex = '';
    private renderedForm: 'small' | 'big' = 'small';
    private formTransition?: { start: number; from: number; to: number };
    private keys!: Record<'left' | 'right' | 'up' | 'down' | 'a' | 'd' | 'w' | 's' | 'space' | 'z' | 'x' | 'shift', Phaser.Input.Keyboard.Key>;
    protected unsubs: Array<() => void> = [];


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
        this.creator = data?.creator;
        this.skipIntro = Boolean(data?.skipIntro);
        this.sequence = null;
        this.previousMode = MovementState.idle;
        this.previousVy = 0;
        this.squash = 0;
        this.facing = 1;
        this.turnStart = -1000;
        this.presentationMs = 0;
        this.from = data?.from ?? 'play';
        this.spawnTile = data?.spawn ?? this.doc.spawn;
        this.frame = 0;
        this.finished = false;
        this.paused = false;
        this.goalReached = false;
        this.lastMissingWarning = -1000;
        this.checkpointName = null;
        this.replay = createReplay();
        this.trace = [];
        this.checkpointHits = [];
        this.currentInput = EMPTY_INPUT;
        this.anim = '';
        this.renderedForm = 'small';
        this.formTransition = undefined;
    }

    create() {
        this.time.paused = false;
        this.tweens.resumeAll();
        const { w, h } = this.doc.size;
        const W = w * TILE;
        const H = h * TILE;
        this.cameras.main.setAlpha(1);
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
        this.effects = new PlayEffects(this, this.runtime.elements, this.doc.meta.theme);

        // 3. game-core Mario-like controller on a Matter compound body.
        const sp = this.tileCenter(this.spawnTile);
        const playerOptions: PlayerOptions = {
            tile: TILE,
            input: () => this.currentInput,
            surface: this.runtime.surface,
            carry: this.runtime.carry,
            onFormChange: (form) => this.onPlayerFormChange(form),
        };
        this.player = createMatterPlayer(this, sp.x, sp.y, playerOptions);
        this.runtime.attachPlayer(this.player);
        this.matter.world.on(Phaser.Physics.Matter.Events.AFTER_UPDATE, this.afterFixedStep, this);

        const tex = playerTexture('small');
        this.playerTex = tex.key;
        this.playerSprite = this.add.sprite(sp.x, sp.y, tex.key, tex.frame).setOrigin(0.5, 1).setDepth(50);
        this.playerSprite.setScale(PLAYER_DISPLAY_H / Math.max(1, this.playerSprite.height));
        this.syncSprite();

        // 4. Fixed 60 Hz clock shared by runtime + player (game-core accumulator).
        installFixedMatterClock(this);

        this.cameraTarget = new PlayerCameraTarget(this.player.body.position.x, this.player.sensors.foot.position.y);
        this.fitZoom();
        const cam = this.cameras.main;
        cam.startFollow(this.cameraTarget, false, 0.15, 0.2, 0, cam.height / cam.zoom * 0.2);
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
        if (this.skipIntro) this.startPlaying();
        else this.showIntro();
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
        if (this.player.state.mode === MovementState.dead || y > this.doc.size.h * TILE + TILE * 2) { this.die(); return; }
        if (this.frame % TRACE_STRIDE === 0) this.trace.push(this.sample());
        if (this.goalReached) this.finish();
        if (this.frame % 6 === 0) this.emitHud();
        this.afterStep();
    }

    update(_time: number, delta: number) {
        if (this.paused) return;
        this.presentationMs += Math.min(delta, 50);
        this.effects?.update(delta);
        // Cinematics animate visual offsets only; no controller steps are fabricated.
        if (this.player && this.sequence !== 'death' && this.sequence !== 'dead' && this.sequence !== 'goal') {
            this.syncSprite();
            const cam = this.cameras.main;
            const mode = this.player.state.mode;
            const grounded = [MovementState.idle, MovementState.walk, MovementState.run, MovementState.skid, MovementState.crouch].includes(mode);
            this.cameraTarget.update(this.player.body.position.x, this.player.sensors.foot.position.y, grounded, cam.height / cam.zoom, this.player.body.velocity.y);
            // Same response time at 60/120 Hz; no rounding feedback into the follow lerp.
            cam.setLerp(1 - Math.pow(0.85, delta / STEP_MS), 1 - Math.pow(0.8, delta / STEP_MS));
        }
    }

    private showIntro() {
        this.sequence = 'intro';
        this.matter.world.pause();
        this.emitPlayState('intro');
        const cam = this.cameras.main;
        cam.setAlpha(1);
        this.effects.iris(true, 550);
        const panel = this.add.rectangle(0, 0, Math.min(580, this.scale.width - 48), 156, 0x0f1424, 0.94).setStrokeStyle(2, 0xffc83d, 0.7);
        const title = this.add.text(0, -24, this.doc.meta.name, { fontFamily: 'system-ui, sans-serif', fontSize: '28px', fontStyle: 'bold', color: '#ffffff', align: 'center', wordWrap: { width: Math.min(520, this.scale.width - 80) } }).setOrigin(0.5);
        const subtitle = this.add.text(0, 35, this.creator ? `by ${this.creator}` : this.levelId ? `LEVEL ${this.levelId}  ·  REALMFORGE` : 'REALMFORGE  ·  TEST PLAY', { fontFamily: 'system-ui, sans-serif', fontSize: '14px', color: '#ffc83d' }).setOrigin(0.5);
        const card = this.add.container(cam.width / 2, cam.height / 2, [panel, title, subtitle]).setScrollFactor(0).setDepth(200).setScale(1 / cam.zoom);
        this.tweens.add({ targets: card, alpha: 0, delay: 1000, duration: 280, onComplete: () => {
            card.destroy();
            this.startPlaying();
        } });
    }

    private startPlaying() {
        this.sequence = null;
        this.cameras.main.setAlpha(1);
        this.matter.world.resume();
        this.emitPlayState('playing');
    }

    private onPlayerFormChange(form: 'small' | 'big') {
        if (form === this.renderedForm) return;
        this.formTransition = { start: this.frame, from: this.renderedForm === 'big' ? PLAYER_DISPLAY_H * 2 : PLAYER_DISPLAY_H, to: form === 'big' ? PLAYER_DISPLAY_H * 2 : PLAYER_DISPLAY_H };
        this.renderedForm = form;
        this.anim = '';
    }

    private syncSprite() {
        const b = this.player.body;
        // Tolerate a game-core checkout that has not received the form API yet.
        const form = typeof this.player.setForm === 'function' && this.player.form === 'big' ? 'big' : 'small';
        this.onPlayerFormChange(form);
        const tex = playerTexture(form);
        if (tex.key !== this.playerTex) {
            this.playerTex = tex.key;
            this.playerSprite.setTexture(tex.key, tex.frame);
            this.anim = '';
        }
        // Matter bounds are swept by velocity. Sensors mark the current physical hull.
        const feet = this.player.sensors.foot.position.y;
        this.playerSprite.setPosition(b.position.x, feet);
        this.playerSprite.setVisible(!this.player.invulnerable || Math.floor(this.frame / 5) % 2 === 0);
        const s = this.player.state;
        // Hold the old facing while braking; turn only when velocity changes direction.
        const facing = s.mode === MovementState.skid && Math.abs(s.vx) > SUBPIXEL * 0.15 ? Math.sign(s.vx) : s.facing;
        if (facing !== this.facing) { this.facing = facing; this.turnStart = this.presentationMs; }
        this.playerSprite.setFlipX(this.facing < 0);
        const grounded = [MovementState.idle, MovementState.walk, MovementState.run, MovementState.skid, MovementState.crouch].includes(s.mode);
        const wasAirborne = [MovementState.jump, MovementState.fall, MovementState.wallSlide].includes(this.previousMode);
        if (grounded && wasAirborne) {
            const impact = Phaser.Math.Clamp(Math.abs(this.previousVy) / (SUBPIXEL * 6), 0.35, 1.4);
            this.squash = impact * 0.1; this.squashStart = this.presentationMs;
            this.effects?.burst('land_puff', this.playerSprite.x, this.playerSprite.y, impact);
            if (impact > 1) this.cameras.main.shake(90, 0.0015);
        } else if (s.mode === MovementState.jump && this.previousMode !== MovementState.jump) {
            this.squash = -0.07; this.squashStart = this.presentationMs;
        }
        if (s.mode === MovementState.skid || (s.mode === MovementState.run && Math.abs(s.vx) >= SUBPIXEL * MOVEMENT.runMax * 0.94)) this.effects?.dust(this.playerSprite.x - this.facing * 15, this.playerSprite.y, s.mode === MovementState.skid, this.facing);
        if (s.mode === MovementState.wallSlide && this.previousMode !== s.mode) this.effects?.burst('dust', this.playerSprite.x + s.facing * 24, this.playerSprite.y - 20, 0.5);
        this.previousMode = s.mode;
        this.previousVy = s.vy;
        const name = ANIM_FOR[s.mode] ?? 'idle';
        if (name !== this.anim) {
            this.anim = name;
            const key = `${this.playerTex}:${name}`;
            const fallback = `${this.playerTex}:${s.mode === MovementState.dead || s.mode === MovementState.wallSlide ? 'fall' : 'idle'}`;
            if (this.anims.exists(key)) this.playerSprite.play(key, true);
            else if (this.anims.exists(fallback)) this.playerSprite.play(fallback, true);
        }
        // Fixed atlas cells preserve pose proportions; the feet stay on the hull through size changes.
        const hullHeight = feet - this.player.sensors.head.position.y;
        let height = hullHeight;
        const transition = this.formTransition;
        if (transition) {
            const elapsed = this.frame - transition.start;
            if (elapsed >= 40) this.formTransition = undefined;
            else height = [transition.from, (transition.from + transition.to) / 2, transition.to][Math.floor(elapsed / 4) % 3];
        }
        const display = characterDisplay(tex.key, this.playerSprite.frame.name, height, form === 'big' && s.mode === MovementState.crouch);
        height = display.height;
        this.playerSprite.y += display.feetOffset;
        const ratio = tex.displaySize ? tex.displaySize.w / tex.displaySize.h : this.playerSprite.width / Math.max(1, this.playerSprite.height);
        const squash = this.squash * Math.max(0, 1 - (this.presentationMs - this.squashStart) / 180);
        const turn = Math.max(0, 1 - (this.presentationMs - this.turnStart) / 95);
        this.playerSprite.setDisplaySize(height * ratio * (1 + squash) * (1 - turn * 0.12), height * (1 - squash));
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
        const z = Math.round(Phaser.Math.Clamp((width || 1280) / (22 * TILE), 0.35, 1.5) * TILE) / TILE;
        const cam = this.cameras.main;
        // Deadzone dimensions are WORLD pixels in Phaser (do not multiply by zoom).
        cam.setZoom(z).setDeadzone(3 * TILE, TILE);
        cam.setFollowOffset(0, cam.height / z * 0.2);
        // At fractional zoom Phaser disables renderRoundPixels but still floors scroll when
        // roundPixels=true. Continuous camera + object coordinates share one render transform.
        cam.setRoundPixels(false);
    }

    protected sfx(key: string) {
        if (hasSfx(`sfx:${key}`) && this.cache.audio.exists(`sfx:${key}`)) this.sound.play(`sfx:${key}`, { volume: 0.5 });
    }

    /** Hook for subclasses (RaceScene). */
    protected afterStep(): void {}

    /** End of the goal walk. Solo play closes the iris (a results dialog takes over); a race keeps the stage. */
    protected afterGoalWalk(): void {
        this.effects.iris(false, 450);
    }

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
        this.effects?.event(type, el);
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
                    this.checkpointName = `Checkpoint ${id}`;
                }
                break;
            }
            case 'goal': {
                // The server only accepts a clear that touched every checkpoint, so the flag does not count
                // until they have all been reached (otherwise the run would be rejected at publish/settle time).
                const missing = this.doc.entities.filter((e) => e.type === 'checkpoint' && !this.checkpointHits.some((c) => c.id === e.id)).length;
                if (missing > 0) {
                    if (this.frame - this.lastMissingWarning > 120) {
                        this.lastMissingWarning = this.frame;
                        this.effects.score(this.playerSprite.x, this.playerSprite.y - TILE * 1.5, missing === 1 ? 'TOUCH THE CHECKPOINT FIRST' : `TOUCH ${missing} CHECKPOINTS FIRST`);
                    }
                    break;
                }
                this.goalReached = true;
                break;
            }
            default:
                break;
        }
        this.emitHud();
    }

    protected die() {
        if (this.sequence === 'death' || this.sequence === 'dead' || this.finished) return;
        this.sequence = 'death';
        this.currentInput = EMPTY_INPUT;
        this.matter.world.pause();
        this.cameras.main.stopFollow();
        this.playerSprite.setVisible(true).setAlpha(1);
        const key = `${this.playerTex}:dead`;
        if (this.anims.exists(key)) this.playerSprite.play({ key, repeat: 0 });
        this.sfx('death');
        const y = this.playerSprite.y;
        // Short hit-stop, a hop, then a fall below the viewport. Physics remains paused.
        this.tweens.add({ targets: this.playerSprite, y: y - TILE * 1.8, delay: 180, duration: 330, ease: 'Quad.easeOut', onComplete: () => {
            this.tweens.add({ targets: this.playerSprite, y: y + this.cameras.main.height / this.cameras.main.zoom + TILE * 2, duration: 650, ease: 'Quad.easeIn', onComplete: () => {
                this.sequence = 'dead';
                this.emitPlayState('dead');
                EventBus.emit('play:died');
            } });
        } });
    }

    protected finish() {
        if (this.finished) return;
        this.finished = true;
        this.sequence = 'goal';
        this.trace.push(this.sample());
        this.matter.world.pause();
        this.sfx('goal');
        this.emitHud();
        this.effects.burst('star', this.playerSprite.x, this.playerSprite.y - TILE);
        this.effects.score(this.playerSprite.x, this.playerSprite.y - TILE * 1.8, 'COURSE CLEAR!');
        this.playerSprite.setFlipX(false).setVisible(true);
        const walk = `${this.playerTex}:walk`;
        if (this.anims.exists(walk)) this.playerSprite.play(walk);
        this.tweens.add({ targets: this.playerSprite, x: this.playerSprite.x + TILE * 2.5, duration: 1300, ease: 'Linear', onComplete: () => this.afterGoalWalk() });
        const run: RunSubmission = {
            timeMs: this.timeMs,
            cleared: true,
            coins: this.coins,
            trace: dedupeTrace(this.trace),
            checkpoints: [...this.checkpointHits],
            inputLog: encodeInputLog(this.replay),
        };
        const result = {
            levelId: this.levelId,
            timeMs: this.timeMs,
            coins: this.coins,
            cleared: true,
            inputs: changePairs(this.replay),
            fromSpawn: this.spawnTile.x === this.doc.spawn.x && this.spawnTile.y === this.doc.spawn.y,
            run,
        };
        this.time.delayedCall(1800, () => {
            this.emitPlayState('cleared');
            EventBus.emit('play:finished', result);
            // Test-play from the editor: the clear is recorded, so go back to the editor instead of leaving the
            // screen faded to black (the Publish dialog needs the editor scene to take its thumbnail).
            if (this.from === 'editor') this.time.delayedCall(500, () => this.backToEditor());
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
        this.unsubs.push(EventBus.subscribe('play:pause', (paused = true) => this.setPaused(paused)));
        this.unsubs.push(EventBus.subscribe('play:resume', () => this.setPaused(false)));
        this.unsubs.push(
            EventBus.subscribe('play:load-level', ({ levelId, level }) => this.scene.restart({ level, levelId, from: this.from })),
        );
        this.unsubs.push(
            EventBus.subscribe('editor:toggle-test', () => {
                if (this.from === 'editor') this.backToEditor();
            }),
        );
    }

    protected emitPlayState(state: PlayState['state']) {
        EventBus.emit('play:state', { state, levelName: this.doc.meta.name, creator: this.creator });
    }

    private setPaused(paused: boolean) {
        if (this.finished || this.sequence === 'death' || this.sequence === 'dead') return;
        this.paused = paused;
        this.currentInput = EMPTY_INPUT;
        this.time.paused = paused;
        if (paused) { this.matter.world.pause(); this.tweens.pauseAll(); }
        else { if (this.sequence !== 'intro') this.matter.world.resume(); this.tweens.resumeAll(); }
        for (const child of this.children.list) if (child instanceof Phaser.GameObjects.Sprite) { if (paused) child.anims.pause(); else child.anims.resume(); }
        this.emitPlayState(paused ? 'paused' : this.sequence === 'intro' ? 'intro' : 'playing');
    }

    /** Return to the editor, resuming its registry copy + undo stack (not the stale boot data). */
    protected backToEditor() {
        this.scene.start(SCENES.Editor, { resume: true });
    }

    protected restart() {
        this.scene.restart({ level: this.file, levelId: this.levelId, from: this.from, spawn: this.spawnTile, creator: this.creator });
    }

    protected teardown() {
        this.time.paused = false;
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
