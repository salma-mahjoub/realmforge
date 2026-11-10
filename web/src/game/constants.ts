import type { Theme } from './level/types';

/** Rendered tile size in px. Assets (asset-pipeline) are produced as 64 px tiles; game-core uses TILE=64 too. */
export const TILE = 64;

/** Fixed simulation rate (SPEC §3.1). */
export const SIM_HZ = 60;
export const STEP_MS = 1000 / SIM_HZ;

export const SCENES = {
    Boot: 'Boot',
    Preloader: 'Preloader',
    Editor: 'EditorScene',
    Play: 'PlayScene',
    Race: 'RaceScene',
    Coop: 'CoopScene',
} as const;
export type GameSceneKey = (typeof SCENES)['Editor' | 'Play' | 'Race' | 'Coop'];

/** Phaser registry keys shared between scenes. */
export const REG = {
    startScene: 'rf:startScene',
    startData: 'rf:startData',
    manifest: 'rf:manifest',
    editorLevel: 'rf:editorLevel',
    editorStack: 'rf:editorStack',
} as const;

export const THEME_SKY: Readonly<Record<Theme, number>> = {
    grass: 0x8fd3ff,
    desert: 0xf7d39a,
    snow: 0xcfe8ff,
    castle: 0x2a2238,
};

export const COLORS = {
    shell: 0x0f1424,
    violet: 0x7c5cff,
    gold: 0xffc83d,
    grid: 0xffffff,
} as const;
