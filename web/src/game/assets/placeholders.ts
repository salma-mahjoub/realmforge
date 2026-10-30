import type { Scene } from 'phaser';
import { ELEMENTS } from '../level/catalog';
import { TILE } from '../constants';
import { placeholderKey } from './registry';

/**
 * Generated fallback textures so every scene works before/without real art.
 * Only creates textures that do not already exist.
 */
export function generatePlaceholderTextures(scene: Scene): number {
    let created = 0;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    const make = (key: string, w: number, h: number, draw: () => void) => {
        if (scene.textures.exists(key)) return;
        g.clear();
        draw();
        g.generateTexture(key, w, h);
        created++;
    };

    for (const el of ELEMENTS) {
        const w = (el.w ?? 1) * TILE;
        const h = (el.h ?? 1) * TILE;
        const c = el.color;
        make(placeholderKey(el.type), w, h, () => {
            switch (el.category) {
                case 'items':
                    g.fillStyle(c, 1).fillCircle(w / 2, h / 2, Math.min(w, h) * 0.32);
                    g.lineStyle(4, 0xffffff, 0.6).strokeCircle(w / 2, h / 2, Math.min(w, h) * 0.32);
                    break;
                case 'enemies':
                    g.fillStyle(c, 1).fillEllipse(w / 2, h * 0.58, w * 0.8, h * 0.7);
                    g.fillStyle(0xffffff, 1).fillCircle(w * 0.38, h * 0.5, 7).fillCircle(w * 0.62, h * 0.5, 7);
                    g.fillStyle(0x111111, 1).fillCircle(w * 0.38, h * 0.52, 3).fillCircle(w * 0.62, h * 0.52, 3);
                    break;
                case 'hazards':
                    if (el.type === 'spikes') {
                        g.fillStyle(c, 1);
                        for (let i = 0; i < 4; i++) g.fillTriangle(i * 16, h, i * 16 + 8, h * 0.35, i * 16 + 16, h);
                    } else if (el.type === 'saw') {
                        g.fillStyle(c, 1).fillCircle(w / 2, h / 2, w * 0.45);
                        g.fillStyle(0x333a48, 1).fillCircle(w / 2, h / 2, w * 0.12);
                    } else {
                        g.fillStyle(c, 1).fillRect(0, h * 0.25, w, h * 0.75);
                    }
                    break;
                case 'flow':
                    if (el.type === 'goal' || el.type === 'checkpoint' || el.type === 'start') {
                        g.fillStyle(0xdddddd, 1).fillRect(w * 0.2, 4, 6, h - 4);
                        g.fillStyle(c, 1).fillTriangle(w * 0.2 + 6, 6, w * 0.85, 22, w * 0.2 + 6, 38);
                    } else {
                        g.fillStyle(c, 1).fillRoundedRect(4, 4, w - 8, h - 4, 8);
                        g.lineStyle(3, 0x000000, 0.35).strokeRoundedRect(4, 4, w - 8, h - 4, 8);
                    }
                    break;
                default:
                    if (el.layer === 'terrain') {
                        g.fillStyle(c, 1).fillRect(0, 0, w, h);
                        g.lineStyle(2, 0x000000, 0.25).strokeRect(1, 1, w - 2, h - 2);
                        if (el.type === 'question_block') {
                            g.fillStyle(0x7a4b00, 1).fillRect(w * 0.42, h * 0.2, w * 0.16, h * 0.4).fillRect(w * 0.42, h * 0.68, w * 0.16, h * 0.12);
                        }
                        if (el.type === 'one_way' || el.type === 'semi_solid') {
                            g.clear();
                            g.fillStyle(c, 1).fillRect(0, 0, w, h * 0.3);
                        }
                    } else {
                        g.fillStyle(c, 1).fillRoundedRect(2, 2, w - 4, h - 4, 6);
                        g.lineStyle(2, 0x000000, 0.3).strokeRoundedRect(2, 2, w - 4, h - 4, 6);
                    }
            }
        });
    }

    // player blob (violet, like the mockups)
    make(placeholderKey('player'), 48, 56, () => {
        g.fillStyle(0x7c5cff, 1).fillEllipse(24, 30, 46, 50);
        g.fillStyle(0xffffff, 1).fillEllipse(18, 24, 9, 13).fillEllipse(31, 24, 9, 13);
        g.fillStyle(0x10132a, 1).fillEllipse(19, 26, 5, 8).fillEllipse(32, 26, 5, 8);
    });

    // editor grid cell
    make('ph:grid', TILE, TILE, () => {
        g.lineStyle(1, 0xffffff, 0.18).strokeRect(0, 0, TILE, TILE);
    });

    g.destroy();
    return created;
}
