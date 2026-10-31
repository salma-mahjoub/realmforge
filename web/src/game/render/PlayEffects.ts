import Phaser from 'phaser';
import type { ElementInstance } from '@realmforge/game-core';
import { effectTexture, elementTexture } from '../assets/registry';
import { TILE } from '../constants';

export type EffectName = 'dust' | 'land_puff' | 'sparkle' | 'brick_debris' | 'stomp_poof' | 'coin_pop' | 'star';
interface Particle {
    sprite: Phaser.GameObjects.Sprite;
    age: number; life: number; vx: number; vy: number; gravity: number; spin: number;
    width: number; height: number; procedural: boolean;
}
interface Label { text: Phaser.GameObjects.Text; age: number; y: number }
interface ObjectView {
    el: ElementInstance; sprite?: Phaser.GameObjects.Sprite; phase: string; enabled: boolean;
    shots: number; texture: string; width: number; height: number;
}

/** Bounded pools: no game objects allocated during footsteps, impacts or collection. */
export class PlayEffects {
    private particles: Particle[] = [];
    private labels: Label[] = [];
    private views: ObjectView[] = [];
    private cursor = 0;
    private labelCursor = 0;
    private elapsed = 0;
    private lastDust = -1000;

    constructor(private scene: Phaser.Scene, elements: Map<string | number, ElementInstance>, private theme: string) {
        if (!scene.textures.exists('vfx:particle')) {
            // Procedural particle primitive only; never used as replacement game artwork.
            const dot = scene.make.graphics({ x: 0, y: 0 });
            dot.fillStyle(0xffffff).fillCircle(8, 8, 7);
            dot.generateTexture('vfx:particle', 16, 16);
            dot.destroy();
        }
        for (let i = 0; i < 128; i++) this.particles.push({ sprite: scene.add.sprite(0, 0, 'vfx:particle').setDepth(65).setActive(false).setVisible(false), age: 1, life: 1, vx: 0, vy: 0, gravity: 0, spin: 0, width: 0, height: 0, procedural: true });
        for (let i = 0; i < 12; i++) this.labels.push({ text: scene.add.text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize: '25px', fontStyle: 'bold', color: '#fff4bf', stroke: '#392514', strokeThickness: 4 }).setOrigin(0.5).setDepth(70).setVisible(false), age: 1000, y: 0 });
        const sprites = scene.children.list.filter((v): v is Phaser.GameObjects.Sprite => v instanceof Phaser.GameObjects.Sprite && !!v.getData('elementType'));
        for (const el of elements.values()) {
            const body = el.bodies[0];
            const sprite = sprites.find((s) => s.getData('elementType') === el.def.type && body && s.getData('elementCentre')?.x === body.position.x && s.getData('elementCentre')?.y === body.position.y);
            this.views.push({ el, sprite, phase: el.phase, enabled: el.enabled, shots: el.bodies.length, texture: sprite?.texture.key ?? '', width: sprite?.displayWidth ?? TILE, height: sprite?.displayHeight ?? TILE });
        }
    }

    burst(name: EffectName, x: number, y: number, strength = 1, direction = 0) {
        const ref = effectTexture(name);
        const authentic = ref && this.scene.textures.exists(ref.key) ? ref : undefined;
        const debris = name === 'brick_debris';
        const dust = name === 'dust' || name === 'land_puff' || name === 'stomp_poof';
        const count = authentic ? (debris ? 4 : 1) : debris ? 8 : dust ? Math.ceil(7 * strength) : 9;
        for (let i = 0; i < Math.min(24, count); i++) {
            const p = this.particles[this.cursor++ % this.particles.length];
            const s = p.sprite;
            s.anims.stop();
            s.setActive(true).setVisible(true).setAlpha(1).setAngle(0).clearTint().setOrigin(authentic?.anchor?.x ?? 0.5, authentic?.anchor?.y ?? 0.5);
            p.procedural = !authentic;
            s.setTexture(authentic?.key ?? (debris ? '__WHITE' : 'vfx:particle'), authentic?.variants?.length ? authentic.variants[i % authentic.variants.length] : authentic?.frame);
            const angle = (i / count) * Math.PI * 2;
            p.age = 0;
            p.life = debris ? 850 : dust ? 420 : 600;
            p.gravity = debris ? 1300 : dust ? -65 : 180;
            p.vx = direction * 60 + Math.cos(angle) * (debris ? 160 : dust ? 70 : 100) * strength;
            p.vy = debris ? -220 - Math.random() * 160 : dust ? -20 - Math.random() * 30 : Math.sin(angle) * 95 - 60;
            p.spin = debris ? (i % 2 ? 240 : -240) : 0;
            const size = authentic ? TILE * (authentic.displaySize?.h ?? 0.65) : (debris ? 12 : dust ? 15 : 5) * strength;
            p.width = authentic ? size * (authentic.displaySize ? authentic.displaySize.w / authentic.displaySize.h : s.width / Math.max(1, s.height)) : size;
            p.height = size;
            s.setPosition(x + (dust ? (i - count / 2) * 4 : 0), y).setDisplaySize(p.width, p.height);
            if (authentic) {
                const key = `${authentic.key}:idle`;
                if (this.scene.anims.exists(key)) {
                    s.play({ key, repeat: 0 });
                    const a = this.scene.anims.get(key);
                    p.life = Math.max(p.life, a.duration);
                }
                if (!debris) { p.vx = 0; p.vy = 0; p.gravity = 0; }
            } else s.setTint(debris ? (this.theme === 'snow' ? 0xb5d8ed : 0xc98142) : dust ? 0xfff2dc : 0xffdd59);
        }
    }

    score(x: number, y: number, value: string) {
        const label = this.labels[this.labelCursor++ % this.labels.length];
        label.age = 0; label.y = y;
        label.text.setText(value).setPosition(x, y).setVisible(true).setAlpha(1);
    }

    dust(x: number, y: number, skid: boolean, direction: number) {
        if (this.elapsed - this.lastDust < (skid ? 80 : 160)) return;
        this.lastDust = this.elapsed;
        this.burst('dust', x, y - 3, skid ? 1 : 0.65, -direction);
    }

    event(type: string, el: ElementInstance) {
        const b = el.bodies[0];
        const x = b?.position.x ?? el.def.x * TILE, y = b?.position.y ?? el.def.y * TILE;
        if (type === 'coin' || type === 'big_coin') {
            this.burst('sparkle', x, y); this.score(x, y - TILE / 2, type === 'big_coin' ? '+10' : '+1');
        } else if (['walker', 'flyer', 'jumper'].includes(type) && !el.enabled) {
            this.burst('stomp_poof', x, y); this.score(x, y - TILE, '100');
        } else if (type === 'spring') {
            this.burst('land_puff', x, y + TILE * 0.4, 0.65);
            const view = this.views.find(v => v.el === el);
            if (view && !this.scene.anims.exists(`${view.texture}:compress`)) this.scene.time.delayedCall(170, () => this.animate(view, 'extend', true));
        }
        else if (['door', 'locked_door', 'pipe'].includes(type)) {
            const view = this.views.find(v => v.el === el);
            if (view) { this.animate(view, 'open', true); this.burst('sparkle', x, y, 0.6); }
        }
    }

    private animate(view: ObjectView, name: string, once = false) {
        const sprite = view.sprite;
        const key = `${view.texture}:${name}`;
        if (!sprite?.active) return;
        if (!this.scene.anims.exists(key)) {
            const alternate = name === 'idle' || name === 'closed' ? elementTexture(view.el.def.type, this.theme) : elementTexture(`${view.el.def.type}_${name === 'extend' ? 'extended' : name}`, this.theme);
            if (!alternate.key.startsWith('ph:') && this.scene.textures.exists(alternate.key)) {
                sprite.anims.stop(); sprite.setTexture(alternate.key, alternate.frame).setDisplaySize(view.width, view.height);
                if (once) this.scene.time.delayedCall(300, () => { if (sprite.active) this.animate(view, 'idle'); });
            }
            return;
        }
        if (sprite?.active && this.scene.anims.exists(key) && (sprite.anims.currentAnim?.key !== key || !sprite.anims.isPlaying)) {
            sprite.play({ key, repeat: once ? 0 : -1 });
            if (once) sprite.once('animationcomplete', () => {
                if (sprite.active) {
                    if (name === 'open' && this.scene.anims.exists(`${view.texture}:close`)) this.animate(view, 'close', true);
                    else this.animate(view, this.scene.anims.exists(`${view.texture}:idle`) ? 'idle' : 'closed');
                }
            });
        }
    }

    update(delta: number) {
        const dt = Math.min(delta, 50), seconds = dt / 1000;
        this.elapsed += dt;
        for (const p of this.particles) {
            if (!p.sprite.active) continue;
            p.age += dt;
            if (p.age >= p.life) { p.sprite.setActive(false).setVisible(false); continue; }
            p.vy += p.gravity * seconds;
            p.sprite.x += p.vx * seconds; p.sprite.y += p.vy * seconds; p.sprite.angle += p.spin * seconds;
            const progress = p.age / p.life;
            p.sprite.setAlpha(Math.min(1, (1 - progress) * 2));
            if (p.procedural) p.sprite.setDisplaySize(p.width * (1 + progress * 0.5), p.height * (1 + progress * 0.5));
        }
        for (const l of this.labels) {
            if (!l.text.visible) continue;
            l.age += dt;
            l.text.y = l.y - l.age * 0.065;
            l.text.setAlpha(Math.min(1, (900 - l.age) / 300));
            if (l.age >= 900) l.text.setVisible(false);
        }
        for (const v of this.views) {
            const e = v.el;
            if (v.enabled && !e.enabled && v.sprite && !v.sprite.active && e.def.type === 'brick') {
                this.burst('brick_debris', e.def.x * TILE, e.def.y * TILE);
                this.scene.cameras.main.shake(110, 0.002);
            }
            if (e.enabled !== v.enabled && e.def.type === 'switch_block') this.animate(v, e.enabled ? 'on' : 'off');
            if (e.phase !== v.phase) {
                const x = e.def.x * TILE, y = e.def.y * TILE;
                if (e.phase === 'used' && e.def.type === 'question_block') {
                    v.sprite?.setData('restAnimation', 'used');
                    if (this.scene.anims.exists(`${v.texture}:used`)) this.animate(v, 'used');
                    else {
                        const used = elementTexture('used_block', this.theme);
                        if (v.sprite?.active && this.scene.textures.exists(used.key)) {
                            v.sprite.anims.stop(); v.sprite.setTexture(used.key, used.frame).setDisplaySize(v.width, v.height).setAlpha(1);
                        }
                    }
                    const requested = String(e.def.props?.reward ?? 'coin');
                    const reward = ['coin', 'big_coin', 'key', 'powerup_double_jump', 'powerup_dash'].includes(requested) ? requested : 'coin';
                    this.rewardPop(x, y - TILE * 0.7, reward);
                } else if (e.def.type === 'checkpoint' && e.phase === 'active') {
                    this.animate(v, 'active'); this.burst('star', x, y - TILE / 2); this.score(x, y - TILE, 'CHECKPOINT');
                } else if (e.def.type === 'goal') this.animate(v, 'wave');
                else if (e.def.type === 'switch') {
                    const hasState = this.scene.anims.exists(`${v.texture}:${e.phase}`);
                    this.animate(v, hasState ? e.phase : e.phase === 'on' ? 'pressed' : 'idle');
                    if (v.sprite?.active && !hasState && !this.scene.anims.exists(`${v.texture}:pressed`)) v.sprite.setDisplaySize(v.width, v.height * (e.phase === 'on' ? 0.45 : 1));
                }
                else if (e.def.type === 'falling_block') this.animate(v, e.phase === 'shaking' ? 'shake' : 'fall');
                else if (e.def.type === 'shell') this.animate(v, e.phase === 'projectile' ? 'spin' : e.phase === 'resting' ? 'idle' : 'walk');
                v.phase = e.phase;
            }
            if (e.def.type === 'cannon' && e.bodies.length > v.shots) {
                const b = e.bodies[0];
                this.animate(v, 'fire', true);
                this.burst('stomp_poof', b.position.x + Number(e.def.props?.direction ?? 1) * TILE * 0.6, b.position.y, 0.6);
            }
            v.shots = e.bodies.length; v.enabled = e.enabled;
        }
    }

    private rewardPop(x: number, y: number, reward: string) {
        // This is a visual copy of the reward already awarded by the runtime, never a new pickup.
        const fx = ['coin', 'big_coin'].includes(reward) ? effectTexture('coin_pop') : undefined;
        const ref = fx && this.scene.textures.exists(fx.key) ? fx : elementTexture(reward, this.theme);
        if (this.scene.textures.exists(ref.key)) {
            const p = this.particles[this.cursor++ % this.particles.length];
            p.sprite.anims.stop();
            p.sprite.setTexture(ref.key, ref.frame).setPosition(x, y).setOrigin(0.5).setVisible(true).setActive(true).clearTint().setAlpha(1).setAngle(0);
            p.width = TILE * (fx?.displaySize?.w ?? 0.55); p.height = TILE * (fx?.displaySize?.h ?? 0.65); p.age = 0; p.life = 650; p.vx = 0; p.vy = -240; p.gravity = 500; p.spin = 0; p.procedural = false;
            p.sprite.setDisplaySize(p.width, p.height);
            const key = `${ref.key}:idle`;
            if (this.scene.anims.exists(key)) p.sprite.play(key);
        }
        this.burst('sparkle', x, y - TILE * 0.4);
        this.score(x, y - TILE, reward === 'big_coin' ? '+10' : '+1');
    }

    /** A geometric aperture, not an image or synthesized animation frame. Canvas uses a fade. */
    iris(open: boolean, duration: number, complete?: () => void) {
        const cam = this.scene.cameras.main;
        if (this.scene.game.renderer.type !== Phaser.WEBGL) {
            if (open) cam.fadeIn(duration, 15, 20, 36); else cam.fadeOut(duration, 15, 20, 36);
            if (complete) this.scene.time.delayedCall(duration, complete);
            return;
        }
        const max = Math.hypot(cam.width, cam.height) / cam.zoom;
        const cover = this.scene.add.rectangle(cam.width / 2, cam.height / 2, cam.width / cam.zoom + 8, cam.height / cam.zoom + 8, 0x0f1424).setScrollFactor(0).setDepth(190);
        const aperture = this.scene.make.graphics({ x: 0, y: 0 }).setScrollFactor(0);
        const mask = aperture.createGeometryMask().setInvertAlpha(true);
        cover.setMask(mask);
        const state = { radius: open ? 0 : max };
        const draw = () => { aperture.clear().fillStyle(0xffffff).fillCircle(cam.width / 2, cam.height / 2, Math.max(0.1, state.radius)); };
        draw();
        this.scene.tweens.add({ targets: state, radius: open ? max : 0, duration, ease: 'Sine.easeInOut', onUpdate: draw, onComplete: () => {
            if (!open) cam.setAlpha(0);
            cover.destroy(); mask.destroy(); aperture.destroy(); complete?.();
        } });
    }

    get activeParticles() { return this.particles.reduce((n, p) => n + Number(p.sprite.active), 0); }
}
