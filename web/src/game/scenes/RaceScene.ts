import Phaser from 'phaser';
import { EventBus, type RemotePlayerState } from '../EventBus';
import { SCENES } from '../constants';
import { PlayScene, type PlaySceneData } from './PlayScene';
import { elementTexture } from '../assets/registry';

export interface RaceSceneData extends PlaySceneData {
    roomCode?: string;
}

/**
 * Versus race (SPEC §3.5/§3.6): the local player is simulated client-side exactly like solo play
 * (client prediction); remote players are interpolated from Colyseus patches (20 Hz) relayed by
 * React via `race:remote-states`. Local state is emitted at 20 Hz on `race:local-state`.
 * Finish order / timing authority is the server — `play:finished` here is only a local claim.
 */
export class RaceScene extends PlayScene {
    private remotes = new Map<string, { sprite: Phaser.GameObjects.Image; label: Phaser.GameObjects.Text; target: RemotePlayerState }>();
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

    protected afterStep() {
        // 60 Hz sim, 20 Hz network
        if (this.frame % 3 === 0) {
            const s = this.player.sprite;
            const v = (s.body as MatterJS.BodyType).velocity;
            EventBus.emit('race:local-state', { x: s.x, y: s.y, vx: v.x, vy: v.y });
        }
        // interpolate remotes toward last snapshot
        for (const r of this.remotes.values()) {
            r.sprite.x = Phaser.Math.Linear(r.sprite.x, r.target.x, 0.35);
            r.sprite.y = Phaser.Math.Linear(r.sprite.y, r.target.y, 0.35);
            r.label.setPosition(r.sprite.x, r.sprite.y - 44);
        }
    }

    private applyRemote(players: RemotePlayerState[]) {
        const seen = new Set<string>();
        for (const p of players) {
            seen.add(p.sessionId);
            let r = this.remotes.get(p.sessionId);
            if (!r) {
                const tex = elementTexture('player');
                const sprite = this.add.image(p.x, p.y, tex.key, tex.frame).setTint(p.color).setAlpha(0.85).setDepth(40);
                const label = this.add
                    .text(p.x, p.y - 44, shortAddress(p.address), { fontFamily: 'system-ui, sans-serif', fontSize: '12px', color: '#ffffff', backgroundColor: '#0f1424aa', padding: { x: 4, y: 2 } })
                    .setOrigin(0.5)
                    .setDepth(41);
                r = { sprite, label, target: p };
                this.remotes.set(p.sessionId, r);
            }
            r.target = p;
            r.sprite.setFlipX(p.vx < 0);
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
