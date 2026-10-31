import Phaser from 'phaser';
import { fixedToWorld, MOVEMENT } from '@realmforge/game-core';
import { EventBus, type RemotePlayerState } from '../EventBus';
import { SCENES, TILE } from '../constants';
import { PlayScene, type PlaySceneData } from './PlayScene';
import { elementTexture } from '../assets/registry';
import type { ElementInstance } from '@realmforge/game-core';

export interface RaceSceneData extends PlaySceneData {
    roomCode?: string;
}

/**
 * Versus race (SPEC §3.5/§3.6): the local player is simulated client-side exactly like solo play
 * (client prediction, game-core controller); remote players are interpolated from Colyseus patches
 * (20 Hz) relayed by React via `race:remote-states`. Local state is emitted at 20 Hz on
 * `race:local-state` in tiles (the server checks per-tick speed in tiles, like run traces).
 * Finish order / timing authority is the server — `play:finished` here is only a local claim.
 */
export class RaceScene extends PlayScene {
    private remotes = new Map<string, { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; target: RemotePlayerState }>();
    roomCode?: string;

    constructor() {
        super(SCENES.Race);
    }

    init(data: RaceSceneData) {
        super.init({ ...data, from: 'race' });
        this.roomCode = data?.roomCode;
        this.remotes.clear();
    }

    protected bindBus() {
        super.bindBus();
        this.unsubs.push(EventBus.subscribe('race:remote-states', (players) => this.applyRemote(players)));
    }

    protected onElementEvent(type: string, el: ElementInstance) {
        super.onElementEvent(type, el);
        if (type === 'checkpoint') EventBus.emit('race:checkpoint', { id: Number(el.def.id) });
        if (type === 'coin' || type === 'big_coin') EventBus.emit('race:coins', this.coins);
    }

    protected afterStep() {
        // 60 Hz sim, 20 Hz network
        if (this.frame % 3 === 0) {
            const s = this.sample();
            const st = this.player.state;
            const scale = TILE / MOVEMENT.referenceTile;
            EventBus.emit('race:local-state', { f: s.f, x: s.x, y: s.y, vx: fixedToWorld(st.vx, scale) / TILE, vy: fixedToWorld(st.vy, scale) / TILE });
        }
        // interpolate remotes toward last snapshot (tiles → px)
        for (const r of this.remotes.values()) {
            const tx = r.target.x * TILE + TILE / 2;
            const ty = r.target.y * TILE + TILE / 2;
            r.sprite.x = Phaser.Math.Linear(r.sprite.x, tx, 0.35);
            r.sprite.y = Phaser.Math.Linear(r.sprite.y, ty, 0.35);
            r.label.setPosition(r.sprite.x, r.sprite.y - 52);
        }
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

function shortAddress(a: string) {
    return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
