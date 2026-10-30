/**
 * PlayerAdapter — the single seam between the scenes and the player controller.
 *
 * TODO(game-core integration): replace `TemporaryMatterPlayer` with
 *   `import { createMatterPlayer, stepController, MOVEMENT, type InputState } from '@realmforge/game-core'`
 * (the Vite alias + tsconfig path already point at ../game-core/src). It is NOT imported yet
 * because game-core is being written concurrently and this package must compile on its own.
 * Keep the `PlayerHandle` surface below stable so PlayScene/RaceScene need no changes; the
 * InputState shape mirrors the one game-core will export.
 */
import type { Scene } from 'phaser';
import { elementTexture } from '../assets/registry';

/** Mirrors game-core's InputState {left,right,up,down,jump,run}. */
export interface InputState {
    left: boolean;
    right: boolean;
    up: boolean;
    down: boolean;
    jump: boolean;
    run: boolean;
}

export const EMPTY_INPUT: InputState = { left: false, right: false, up: false, down: false, jump: false, run: false };

/** Replay bitmask (SPEC §3.6 `frame, buttons`). Must match game-core's encoder once integrated. */
export const BUTTON_BITS = { left: 1, right: 2, up: 4, down: 8, jump: 16, run: 32 } as const;

export function encodeButtons(i: InputState): number {
    return (
        (i.left ? BUTTON_BITS.left : 0) |
        (i.right ? BUTTON_BITS.right : 0) |
        (i.up ? BUTTON_BITS.up : 0) |
        (i.down ? BUTTON_BITS.down : 0) |
        (i.jump ? BUTTON_BITS.jump : 0) |
        (i.run ? BUTTON_BITS.run : 0)
    );
}

export interface PlayerOptions {
    textureKey?: string;
    tint?: number;
}

export interface PlayerHandle {
    readonly sprite: Phaser.Physics.Matter.Sprite;
    readonly grounded: boolean;
    /** Is `body` (or a part of it) this player's body? */
    owns(body: MatterJS.BodyType): boolean;
    /** Advance one fixed 60 Hz frame. */
    step(input: InputState): void;
    teleport(x: number, y: number): void;
    /** Spring / stomp launch; `power` 1 = default spring. */
    launch(power: number): void;
    destroy(): void;
}

/** Collision categories (SPEC §3.1). Shared with elements via this module until game-core owns them. */
export const CATEGORY = {
    player: 0x0001,
    enemy: 0x0002,
    solid: 0x0004,
    oneway: 0x0008,
    hazard: 0x0010,
    pickup: 0x0020,
    sensor: 0x0040,
} as const;

// Temporary tuning in Matter units (px per 16.67 ms step) for TILE = 64 and gravity.y = 2.
const T = {
    walk: 5,
    run: 8,
    accelGround: 0.6,
    accelAir: 0.35,
    friction: 0.75,
    jump: 17,
    jumpCut: 0.5,
    maxFall: 18,
    coyoteFrames: 6, // 100 ms
    bufferFrames: 6, // 100 ms
    spring: 22,
};

class TemporaryMatterPlayer implements PlayerHandle {
    readonly sprite: Phaser.Physics.Matter.Sprite;
    private readonly parts = new Set<number>();
    private readonly foot: MatterJS.BodyType;
    private groundTouches = 0;
    private framesSinceGround = 999;
    private framesSinceJumpPress = 999;
    private prevJump = false;
    private jumping = false;
    private texKey: string;
    private anim = '';

    constructor(private readonly scene: Scene, x: number, y: number, opts: PlayerOptions = {}) {
        const w = 44;
        const h = 54;
        const { bodies, body } = scene.matter;
        const main = bodies.rectangle(0, 0, w, h, { chamfer: { radius: 12 }, label: 'player' });
        this.foot = bodies.rectangle(0, h / 2, w * 0.7, 8, { isSensor: true, label: 'player-foot' });
        const compound = body.create({
            parts: [main, this.foot],
            friction: 0,
            frictionStatic: 0,
            frictionAir: 0,
            restitution: 0,
            label: 'player',
            collisionFilter: { category: CATEGORY.player, mask: 0xffff, group: 0 },
        });
        const tex = opts.textureKey ? { key: opts.textureKey, frame: undefined } : elementTexture('player');
        this.sprite = scene.matter.add.sprite(x, y, tex.key, tex.frame);
        this.texKey = tex.key;
        // Scale art (e.g. 128 px atlas frames) to ~1 tile BEFORE attaching the body:
        // Matter game objects scale their body on setScale, setExistingBody does not.
        if (this.sprite.height > 80) this.sprite.setScale(70 / this.sprite.height);
        this.sprite.setExistingBody(compound);
        this.sprite.setFixedRotation();
        this.sprite.setPosition(x, y);
        if (opts.tint !== undefined) this.sprite.setTint(opts.tint);
        for (const p of compound.parts) this.parts.add(p.id);

        scene.matter.world.on('collisionstart', this.onStart, this);
        scene.matter.world.on('collisionend', this.onEnd, this);
    }

    get grounded() {
        return this.groundTouches > 0;
    }

    owns(b: MatterJS.BodyType) {
        return this.parts.has(b.id);
    }

    private footPairOther(pair: MatterJS.ICollisionPair): MatterJS.BodyType | null {
        const a = pair.bodyA as MatterJS.BodyType;
        const b = pair.bodyB as MatterJS.BodyType;
        if (a === this.foot && !b.isSensor) return b;
        if (b === this.foot && !a.isSensor) return a;
        return null;
    }

    private onStart = (e: Phaser.Physics.Matter.Events.CollisionStartEvent) => {
        for (const p of e.pairs) if (this.footPairOther(p)) this.groundTouches++;
    };

    private onEnd = (e: Phaser.Physics.Matter.Events.CollisionEndEvent) => {
        for (const p of e.pairs) if (this.footPairOther(p)) this.groundTouches = Math.max(0, this.groundTouches - 1);
    };

    step(input: InputState) {
        const body = this.sprite.body as MatterJS.BodyType;
        let { x: vx, y: vy } = body.velocity;

        this.framesSinceGround = this.grounded ? 0 : this.framesSinceGround + 1;
        const pressed = input.jump && !this.prevJump;
        this.framesSinceJumpPress = pressed ? 0 : this.framesSinceJumpPress + 1;
        this.prevJump = input.jump;

        const max = input.run ? T.run : T.walk;
        const accel = this.grounded ? T.accelGround : T.accelAir;
        const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        if (dir !== 0) {
            vx += dir * accel;
            if (Math.abs(vx) > max) vx = Math.sign(vx) * Math.max(max, Math.abs(vx) - accel);
            this.sprite.setFlipX(dir < 0);
        } else if (this.grounded) {
            vx *= T.friction;
            if (Math.abs(vx) < 0.05) vx = 0;
        }

        // coyote time + jump buffer
        if (this.framesSinceJumpPress <= T.bufferFrames && this.framesSinceGround <= T.coyoteFrames && !this.jumping) {
            vy = -T.jump;
            this.jumping = true;
            this.framesSinceJumpPress = 999;
            this.framesSinceGround = 999;
        }
        // variable jump height
        if (this.jumping && !input.jump && vy < 0) {
            vy *= T.jumpCut;
            this.jumping = false;
        }
        if (vy >= 0) this.jumping = false;
        if (vy > T.maxFall) vy = T.maxFall;

        this.sprite.setVelocity(vx, vy);
        this.animate(vx, vy, input.run);
    }

    /** Play `<texture>:<state>` animations when the asset manifest provides them. */
    private animate(vx: number, vy: number, run: boolean) {
        const state = !this.grounded ? (vy < 0 ? 'jump' : 'fall') : Math.abs(vx) > 0.4 ? (run ? 'run' : 'walk') : 'idle';
        if (state === this.anim) return;
        this.anim = state;
        const key = `${this.texKey}:${state}`;
        if (this.scene.anims.exists(key)) this.sprite.play(key, true);
    }

    teleport(x: number, y: number) {
        this.sprite.setPosition(x, y);
        this.sprite.setVelocity(0, 0);
        this.groundTouches = 0;
    }

    launch(power: number) {
        this.sprite.setVelocityY(-T.spring * power);
        this.jumping = false;
    }

    destroy() {
        this.scene.matter.world?.off('collisionstart', this.onStart, this);
        this.scene.matter.world?.off('collisionend', this.onEnd, this);
        this.sprite.destroy();
    }
}

/** Factory used by scenes. Swap the implementation here when game-core lands. */
export function createPlayer(scene: Scene, x: number, y: number, opts?: PlayerOptions): PlayerHandle {
    return new TemporaryMatterPlayer(scene, x, y, opts);
}
