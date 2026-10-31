import Phaser from 'phaser';
import type { ElementInstance } from '@realmforge/game-core';
import { elementTexture } from '../assets/registry';
import { TILE } from '../constants';

/** Constraint joints have no visible art in Matter unless debug is on. Draw them independently. */
export function drawMechanisms(scene: Phaser.Scene, elements: Map<string | number, ElementInstance>) {
    const graphics = scene.add.graphics().setDepth(-1);
    const effects = scene.add.graphics().setDepth(2);
    const pivots = new Map<string | number, Phaser.GameObjects.Image>();
    const pivotRef = elementTexture('seesaw_pivot');
    if (scene.textures.exists(pivotRef.key)) for (const [id, element] of elements) {
        if (element.def.type !== 'seesaw') continue;
        pivots.set(id, scene.add.image(element.def.x * TILE, element.def.y * TILE + TILE * 0.1, pivotRef.key, pivotRef.frame)
            .setOrigin(0.5, 0).setDisplaySize(TILE * (pivotRef.displaySize?.w ?? 0.8), TILE * (pivotRef.displaySize?.h ?? 0.7)).setDepth(-1));
    }
    const update = () => {
        graphics.clear();
        effects.clear();
        for (const element of elements.values()) {
            if (!element.enabled) continue;
            const body = element.bodies[0];
            if (!body) continue;
            if (element.def.type === 'conveyor_belt') {
                const { min, max } = body.bounds;
                const offset = (scene.time.now / 24 * Number(element.def.props?.direction ?? 1)) % 16;
                effects.fillStyle(0x28374b).fillRoundedRect(min.x, min.y, max.x - min.x, max.y - min.y, 6);
                effects.lineStyle(3, 0x93a7ba).lineBetween(min.x + 4, min.y + 2, max.x - 4, min.y + 2);
                effects.lineStyle(2, 0xffc83d);
                for (let x = min.x + 16 + offset; x < max.x - 12; x += 16) effects.lineBetween(x, min.y + 5, x - 5, max.y - 3);
            }
            if (element.def.type === 'lava') {
                const { min, max } = body.bounds;
                const amplitude = TILE / 24;
                effects.lineStyle(4, 0xffc83d, 0.85).beginPath();
                for (let x = min.x; x <= max.x; x += 4) {
                    const y = min.y + 5 + Math.sin(x / 12 + scene.time.now / 200) * amplitude;
                    if (x === min.x) effects.moveTo(x, y); else effects.lineTo(x, y);
                }
                effects.strokePath();
            }
            if (element.def.type === 'seesaw' && !pivots.has(element.def.id)) {
                const { x, y } = body.position;
                graphics.fillStyle(0x53677d).fillTriangle(x, y + 4, x - TILE * 0.3, y + TILE * 0.65, x + TILE * 0.3, y + TILE * 0.65);
                graphics.fillStyle(0xa7bacd).fillCircle(x, y + 4, TILE * 0.1);
            }
            if (element.def.type === 'pendulum_ball') {
                const anchor = { x: element.def.x * TILE, y: element.def.y * TILE };
                const dx = body.position.x - anchor.x, dy = body.position.y - anchor.y;
                const count = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 16));
                graphics.lineStyle(6, 0x28374b).lineBetween(anchor.x, anchor.y, body.position.x, body.position.y);
                graphics.lineStyle(3, 0x93a7ba);
                for (let i = 0; i < count; i++) graphics.strokeCircle(anchor.x + dx * i / count, anchor.y + dy * i / count, 5);
            }
            if (element.def.type === 'chain_bridge') {
                graphics.lineStyle(4, 0x53677d);
                for (let i = 1; i < element.bodies.length; i++) {
                    const a = element.bodies[i - 1].position, b = element.bodies[i].position;
                    graphics.lineBetween(a.x, a.y - TILE * 0.35, b.x, b.y - TILE * 0.35);
                    graphics.lineBetween(b.x, b.y - TILE * 0.35, b.x, b.y);
                }
            }
        }
    };
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, update);
    update();
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        scene.events.off(Phaser.Scenes.Events.POST_UPDATE, update);
        pivots.forEach((pivot) => pivot.destroy());
    });
}
