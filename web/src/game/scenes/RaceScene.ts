import Phaser from 'phaser';
import { fixedToWorld, MOVEMENT } from '@realmforge/game-core';
import { EventBus, type RemotePlayerState } from '../EventBus';
import { SCENES, TILE } from '../constants';
import { PlayScene, type PlaySceneData } from './PlayScene';
import { elementTexture } from '../assets/registry';
import type { ElementInstance, InputState } from '@realmforge/game-core';

/**
 * Keys held right now, tracked on the window. A scene restart (the race restarts on GO) creates fresh Phaser
 * key objects that only see *new* keydowns, so a player already holding → at GO would not move.
 */
const held = new Set<string>();
if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => held.add(e.code));
    window.addEventListener('keyup', (e) => held.delete(e.code));
    window.addEventListener('blur', () => held.clear());
}
const isHeld = (...codes: string[]) => codes.some((c) => held.has(c));

export interface RaceSceneData extends PlaySceneData {
    /** Set from the server's GO on: positions are only sent while racing (lobby warm-up frames would be refused as 'clock ahead'). */
    racing?: boolean;
    roomCode?: string;
    spectator?: boolean;
}

/**
 * Versus race (SPEC §3.5/§3.6): the local player is simulated client-side exactly like solo play
 * (client prediction, game-core controller); remote players are interpolated from Colyseus patches
 * (20 Hz) relayed by React via `race:remote-states`. Local state is emitted at 20 Hz on
 * `race:local-state` in tiles (the server checks per-tick speed in tiles, like run traces).
 * Finish order / timing authority is the server — `play:finished` here is only a local claim.
 */
export class RaceScene extends PlayScene {
    private finishNote?: Phaser.GameObjects.Text;
    private remotes = new Map<string, { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; target: RemotePlayerState }>();
    roomCode?: string;
    private spectator = false;
    protected racing = false;
    private followedId: string | null = null;

    constructor(key: string = SCENES.Race) {
        super(key);
    }

    init(data: RaceSceneData) {
        this.finishNote = undefined;
        super.init({ ...data, from: 'race' });
        this.roomCode = data?.roomCode;
        this.racing = Boolean(data?.racing);
        this.spectator = Boolean(data?.spectator);
        this.remotes.clear();
        this.followedId = null;
    }

    create() {
        super.create();
        if (this.spectator) this.playerSprite.setVisible(false);
    }

    /** A restart starts the frame counter again; tell the room first so it keeps accepting our positions. */
    protected restart(raceStart = false) {
        EventBus.emit('race:respawn');
        this.scene.restart({ level: this.file, levelId: this.levelId, from: 'race', spawn: raceStart ? undefined : this.spawnTile, creator: this.creator, roomCode: this.roomCode, skipIntro: raceStart, racing: raceStart || this.racing, spectator: this.spectator } satisfies RaceSceneData);
    }

    protected bindBus() {
        super.bindBus();
        this.unsubs.push(EventBus.subscribe('race:remote-states', (players) => this.applyRemote(players)));
        // GO: lobby warm-up frames and position do not count. Restart at spawn on frame 0; `restart()` also
        // tells the server (race:respawn), which then expects the next position at spawn from frame 0.
        this.unsubs.push(EventBus.subscribe('race:start', () => this.restart(true)));
        this.unsubs.push(EventBus.subscribe('race:ended', (place) => this.showNote(place === 1 ? 'YOU WIN!' : place ? `RACE OVER  ·  YOU PLACED ${ordinal(place)}` : 'RACE OVER')));
        this.unsubs.push(EventBus.subscribe('watch:follow', (id) => { this.followedId = id; }));
    }

    protected onElementEvent(type: string, el: ElementInstance) {
        super.onElementEvent(type, el);
        if (type === 'checkpoint') EventBus.emit('race:checkpoint', { id: Number(el.def.id) });
        if (type === 'coin' || type === 'big_coin') EventBus.emit('race:coins', this.coins);
    }

    protected readInput(): InputState {
        const k = super.readInput();
        if (this.paused) return k;
        return {
            left: k.left || isHeld('ArrowLeft', 'KeyA'),
            right: k.right || isHeld('ArrowRight', 'KeyD'),
            up: k.up || isHeld('ArrowUp', 'KeyW'),
            down: k.down || isHeld('ArrowDown', 'KeyS'),
            jump: k.jump || isHeld('Space', 'KeyZ'),
            run: k.run || isHeld('ShiftLeft', 'ShiftRight', 'KeyX'),
        };
    }

    protected afterStep() {
        // 60 Hz sim, 20 Hz network
        if (!this.spectator && this.frame % 3 === 0) {
            const s = this.sample();
            const st = this.player.state;
            const scale = TILE / MOVEMENT.referenceTile;
            if (this.racing) EventBus.emit('race:local-state', { f: s.f, x: s.x, y: s.y, vx: fixedToWorld(st.vx, scale) / TILE, vy: fixedToWorld(st.vy, scale) / TILE });
        }
    }

    /** Remotes are interpolated every render frame: physics steps stop once the local player finishes. */
    update(time: number, delta: number) {
        super.update(time, delta);
        // interpolate remotes toward last snapshot (tiles → px)
        for (const r of this.remotes.values()) {
            const tx = r.target.x * TILE + TILE / 2;
            const ty = r.target.y * TILE + TILE / 2;
            r.sprite.x = Phaser.Math.Linear(r.sprite.x, tx, 0.35);
            r.sprite.y = Phaser.Math.Linear(r.sprite.y, ty, 0.35);
            r.label.setPosition(r.sprite.x, r.sprite.y - 52);
        }
        if (this.spectator) {
            const racers = [...this.remotes.entries()];
            const selected = racers.find(([id]) => id === this.followedId)?.[1];
            const leader = selected ?? racers.sort((a, b) => Number(Boolean(b[1].target.finished)) - Number(Boolean(a[1].target.finished)) || (b[1].target.finished ? (a[1].target.finishTimeMs ?? Infinity) - (b[1].target.finishTimeMs ?? Infinity) : b[1].target.x - a[1].target.x))[0]?.[1];
            if (leader) this.cameras.main.startFollow(leader.sprite, false, 0.12, 0.16);
        }
    }

    /** The race goes on after you finish: keep the stage visible and say so, instead of the solo iris close. */
    protected afterGoalWalk() {
        if (!this.finishNote) this.showNote('FINISHED  ·  WAITING FOR THE OTHERS');
    }

    protected showNote(text: string) {
        this.finishNote?.destroy();
        const cam = this.cameras.main;
        const note = this.add
            .text(cam.width / 2, 28, text, { fontFamily: 'system-ui, sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#ffc83d', backgroundColor: '#0f1424d9', padding: { x: 12, y: 6 } })
            .setOrigin(0.5, 0)
            .setScrollFactor(0)
            .setDepth(200)
            .setScale(1 / cam.zoom);
        // Scroll-factor-0 objects still zoom around the camera centre: undo that so the note sits 28 px from the top.
        note.setPosition(cam.width / 2, cam.height / 2 + (28 - cam.height / 2) / cam.zoom);
        this.finishNote = note;
    }

    private applyRemote(players: RemotePlayerState[]) {
        const seen = new Set<string>();
        for (const p of players) {
            seen.add(p.sessionId);
            let r = this.remotes.get(p.sessionId);
            if (!r) {
                const tex = elementTexture('player');
                const x = p.x * TILE + TILE / 2;
                const y = p.y * TILE + TILE / 2;
                const sprite = this.add.sprite(x, y, tex.key, tex.frame).setTint(p.color).setAlpha(0.85).setDepth(40);
                const height = 15 / MOVEMENT.referenceTile * TILE;
                sprite.setDisplaySize(tex.displaySize ? height * tex.displaySize.w / tex.displaySize.h : 0.8 * TILE, height);
                const label = this.add
                    .text(x, y - 52, shortAddress(p.address), { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#ffffff', backgroundColor: '#0f1424aa', padding: { x: 4, y: 2 } })
                    .setOrigin(0.5)
                    .setDepth(41);
                r = { sprite, label, target: p };
                this.remotes.set(p.sessionId, r);
            }
            r.target = p;
            if (p.vx !== 0) r.sprite.setFlipX(p.vx < 0);
            const key = `${r.sprite.texture.key}:${p.anim ?? (Math.abs(p.vy) > 0.05 ? 'jump' : Math.abs(p.vx) > 0.01 ? 'run' : 'idle')}`;
            if (this.anims.exists(key)) r.sprite.play(key, true);
        }
        for (const [id, r] of this.remotes) {
            if (!seen.has(id)) {
                r.sprite.destroy();
                r.label.destroy();
                this.remotes.delete(id);
            }
        }
    }
}

function ordinal(n: number) {
    return `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`;
}

function shortAddress(a: string) {
    return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
