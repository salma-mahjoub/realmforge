import { createEmptyLevel, encodeLevel } from '../level/serialize';
import type { LevelFileV1, Theme } from '../level/types';

export type LevelTemplateId = 'flat-starter' | 'staircase' | 'castle-gauntlet';
export const LEVEL_TEMPLATES: readonly { id: LevelTemplateId; label: string; description: string }[] = [
    { id: 'flat-starter', label: 'Flat starter', description: 'A clean, roomy practice course.' },
    { id: 'staircase', label: 'Staircase', description: 'A rising platforming route.' },
    { id: 'castle-gauntlet', label: 'Castle gauntlet', description: 'A short hazard and enemy course.' },
];

export function createTemplate(id: LevelTemplateId): LevelFileV1 {
    const theme: Theme = id === 'castle-gauntlet' ? 'castle' : 'grass';
    const doc = createEmptyLevel(id === 'flat-starter' ? 100 : 84, 24, theme);
    doc.meta.name = LEVEL_TEMPLATES.find((t) => t.id === id)!.label;
    doc.meta.music = theme === 'castle' ? 'castle_01' : 'grass_01';
    doc.spawn = { x: 3, y: 20 };
    doc.goal = { x: doc.size.w - 5, y: 20 };
    doc.entities = [
        { id: 1, type: 'start', x: 3, y: 20 },
        { id: 2, type: 'goal', x: doc.size.w - 5, y: 20 },
    ];
    if (id === 'staircase') {
        for (let i = 0; i < 8; i++) for (let y = 18 - i; y < 20; y++) doc.terrain[y * doc.size.w + 14 + i * 7] = 1;
        doc.entities.push({ id: 3, type: 'coin', x: 20, y: 16 }, { id: 4, type: 'coin', x: 41, y: 12 }, { id: 5, type: 'coin', x: 62, y: 8 });
    }
    if (id === 'castle-gauntlet') {
        for (let i = 0; i < 5; i++) {
            const x = 18 + i * 13;
            doc.terrain[19 * doc.size.w + x] = 1;
            doc.entities.push({ id: 3 + i, type: i % 2 ? 'saw' : 'spikes', x, y: 18 });
        }
        doc.entities.push({ id: 8, type: 'walker', x: 41, y: 19 }, { id: 9, type: 'checkpoint', x: 43, y: 20 }, { id: 10, type: 'coin', x: 58, y: 15 });
    }
    return encodeLevel(doc);
}

/** Tracks shipped by both curated music manifests. */
export const AVAILABLE_MUSIC = ['grass_01', 'snow_01', 'castle_01'] as const;
export function isAvailableMusic(track: string): boolean { return (AVAILABLE_MUSIC as readonly string[]).includes(track); }
export function validatedMusic(theme: Theme, track: string): string {
    if (isAvailableMusic(track)) return track;
    return theme === 'snow' ? 'snow_01' : theme === 'castle' ? 'castle_01' : 'grass_01';
}
