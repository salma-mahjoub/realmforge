/**
 * Editor palette catalog (SPEC §3.2). Pure data — the physics implementation of each element
 * lives in src/game/elements/ (owned by elements-runtime); this file only describes what the
 * editor can place and which properties the property panel exposes.
 */
import type { ElementCategory, ElementType, EntityProps, TerrainType } from './types';

export type PropKind = 'number' | 'select' | 'boolean' | 'link' | 'path';

export interface PropSpec {
    key: string;
    label: string;
    kind: PropKind;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
    options?: readonly string[];
    default?: number | string | boolean;
}

export interface ElementDef {
    type: ElementType;
    label: string;
    category: ElementCategory;
    /** Terrain goes into the RLE grid, everything else into entities[]. */
    layer: 'terrain' | 'entity';
    /** Placeholder colour (used when no texture from /assets/manifest.json is available). */
    color: number;
    /** Footprint in tiles, for placement preview. */
    w?: number;
    h?: number;
    /** Only one per level (start/goal). */
    unique?: boolean;
    defaults?: EntityProps;
    props?: readonly PropSpec[];
}

const speed = (def = 80): PropSpec => ({ key: 'speed', label: 'Speed', kind: 'number', unit: 'px/s', min: 0, max: 400, step: 10, default: def });
const direction: PropSpec = { key: 'direction', label: 'Direction', kind: 'select', options: ['left', 'right', 'up', 'down'] };
const timer = (label = 'Timer'): PropSpec => ({ key: 'timer', label, kind: 'number', unit: 'ms', min: 0, max: 20000, step: 100 });
const delay: PropSpec = { key: 'delay', label: 'Start delay', kind: 'number', unit: 's', min: 0, max: 30, step: 0.5 };
const link: PropSpec = { key: 'link', label: 'Link target', kind: 'link' };
const path: PropSpec = { key: 'path', label: 'Path', kind: 'path' };
const loop: PropSpec = { key: 'loop', label: 'Loop', kind: 'boolean' };
const motion: PropSpec = { key: 'motion', label: 'Motion', kind: 'select', options: ['linear', 'ease'] };

export const CATEGORIES: readonly { id: ElementCategory; label: string; icon: string }[] = [
    { id: 'terrain', label: 'Terrain', icon: '▲' },
    { id: 'hazards', label: 'Hazards', icon: '⚠' },
    { id: 'dynamic', label: 'Dynamic', icon: '⚙' },
    { id: 'moving', label: 'Moving', icon: '⇄' },
    { id: 'enemies', label: 'Enemies', icon: '☠' },
    { id: 'items', label: 'Items', icon: '◆' },
    { id: 'flow', label: 'Flow', icon: '⚑' },
];

export const ELEMENTS: readonly ElementDef[] = [
    // Terrain — static bodies, per-tile friction
    { type: 'ground', label: 'Ground', category: 'terrain', layer: 'terrain', color: 0x8b5a2b },
    { type: 'brick', label: 'Brick', category: 'terrain', layer: 'terrain', color: 0xc0583a },
    { type: 'question', label: 'Question Block', category: 'terrain', layer: 'terrain', color: 0xffc83d },
    { type: 'ice', label: 'Ice', category: 'terrain', layer: 'terrain', color: 0x9fe3ff },
    { type: 'slime', label: 'Slime', category: 'terrain', layer: 'terrain', color: 0x6ddc5a },
    { type: 'oneway', label: 'One-way Platform', category: 'terrain', layer: 'terrain', color: 0xb08a5a },
    { type: 'semisolid', label: 'Semi-solid', category: 'terrain', layer: 'terrain', color: 0xd9b48a },
    // Hazards — sensor or kinematic
    { type: 'spikes', label: 'Spikes', category: 'hazards', layer: 'entity', color: 0xcfd6e6, props: [{ key: 'rotation', label: 'Rotation', kind: 'select', options: ['0', '90', '180', '270'] }] },
    { type: 'lava', label: 'Lava', category: 'hazards', layer: 'entity', color: 0xff5a1f },
    { type: 'saw', label: 'Saw', category: 'hazards', layer: 'entity', color: 0x9aa3b5, defaults: { speed: 180 }, props: [speed(180), path, loop] },
    { type: 'falling_block', label: 'Falling Block', category: 'hazards', layer: 'entity', color: 0x7a7f8f, defaults: { timer: 500 }, props: [timer('Fall delay')] },
    // Dynamic — dynamic bodies and constraints
    { type: 'crate', label: 'Crate', category: 'dynamic', layer: 'entity', color: 0xb7793e },
    { type: 'seesaw', label: 'Seesaw', category: 'dynamic', layer: 'entity', color: 0x8d6e4f, w: 6, defaults: { length: 6 }, props: [{ key: 'length', label: 'Length', kind: 'number', unit: 'tiles', min: 3, max: 12, step: 1 }] },
    { type: 'pendulum', label: 'Wrecking Ball', category: 'dynamic', layer: 'entity', color: 0x4b5263, defaults: { length: 5 }, props: [{ key: 'length', label: 'Chain length', kind: 'number', unit: 'tiles', min: 2, max: 10, step: 1 }] },
    { type: 'chain_bridge', label: 'Chain Bridge', category: 'dynamic', layer: 'entity', color: 0x9b6b3d, w: 8, defaults: { length: 8 }, props: [{ key: 'length', label: 'Planks', kind: 'number', min: 3, max: 20, step: 1 }] },
    { type: 'spring', label: 'Spring', category: 'dynamic', layer: 'entity', color: 0xe23b4e, defaults: { power: 1 }, props: [{ key: 'power', label: 'Power', kind: 'number', min: 0.5, max: 2, step: 0.1 }] },
    { type: 'conveyor', label: 'Conveyor Belt', category: 'dynamic', layer: 'entity', color: 0x5c6370, w: 4, defaults: { speed: 60, direction: 'right' }, props: [speed(60), direction] },
    // Moving — kinematic, tweens
    { type: 'moving_platform', label: 'Platform', category: 'moving', layer: 'entity', color: 0x7cc7ff, w: 3, defaults: { speed: 80, loop: true, motion: 'linear', delay: 0, path: [] }, props: [speed(80), path, loop, motion, delay] },
    { type: 'elevator', label: 'Elevator', category: 'moving', layer: 'entity', color: 0x8fa3bf, w: 3, defaults: { speed: 60, direction: 'up' }, props: [speed(60), direction, timer('Pause at end')] },
    { type: 'rotating_platform', label: 'Rotator', category: 'moving', layer: 'entity', color: 0xa0a8b8, w: 3, defaults: { speed: 45, direction: 'right' }, props: [{ key: 'speed', label: 'Speed', kind: 'number', unit: '°/s', min: 0, max: 360, step: 5 }, direction] },
    // Enemies — dynamic with AI state machine
    { type: 'walker', label: 'Walker', category: 'enemies', layer: 'entity', color: 0xe0464e, defaults: { speed: 60, direction: 'left' }, props: [speed(60), direction] },
    { type: 'shell', label: 'Shell', category: 'enemies', layer: 'entity', color: 0x3fbf7f, defaults: { speed: 60, direction: 'left' }, props: [speed(60), direction] },
    { type: 'flyer', label: 'Flyer', category: 'enemies', layer: 'entity', color: 0xd94ad0, defaults: { speed: 50, amplitude: 2 }, props: [speed(50), { key: 'amplitude', label: 'Amplitude', kind: 'number', unit: 'tiles', min: 0, max: 8, step: 0.5 }] },
    { type: 'jumper', label: 'Jumper', category: 'enemies', layer: 'entity', color: 0xff8a3d, defaults: { timer: 1500 }, props: [timer('Jump every')] },
    { type: 'cannon', label: 'Cannon', category: 'enemies', layer: 'entity', color: 0x2b2f3a, defaults: { timer: 2000, direction: 'left' }, props: [timer('Fire every'), direction] },
    // Items — sensors
    { type: 'coin', label: 'Coin', category: 'items', layer: 'entity', color: 0xffc83d },
    { type: 'big_coin', label: 'Big Coin', category: 'items', layer: 'entity', color: 0xffb000, w: 2, h: 2, defaults: { value: 10 } },
    { type: 'key', label: 'Key', category: 'items', layer: 'entity', color: 0xffe066, props: [link] },
    { type: 'powerup_double_jump', label: 'Double Jump', category: 'items', layer: 'entity', color: 0x7c5cff },
    { type: 'powerup_dash', label: 'Dash', category: 'items', layer: 'entity', color: 0x22d3ee },
    // Flow — sensors
    { type: 'start', label: 'Start', category: 'flow', layer: 'entity', color: 0x4ade80, unique: true },
    { type: 'checkpoint', label: 'Checkpoint', category: 'flow', layer: 'entity', color: 0x60a5fa },
    { type: 'goal', label: 'Goal Flag', category: 'flow', layer: 'entity', color: 0x7c5cff, unique: true, h: 3 },
    { type: 'door', label: 'Door', category: 'flow', layer: 'entity', color: 0x9b6b3d, h: 2, props: [link] },
    { type: 'pipe', label: 'Pipe', category: 'flow', layer: 'entity', color: 0x22c55e, w: 2, h: 2, props: [link, direction] },
    { type: 'lock_door', label: 'Key-lock Door', category: 'flow', layer: 'entity', color: 0xa16207, h: 2, props: [link] },
    { type: 'switch', label: 'Switch', category: 'flow', layer: 'entity', color: 0xf43f5e, defaults: { timer: 0 }, props: [link, timer('Duration (0 = toggle)')] },
];

export const ELEMENT_BY_TYPE: Readonly<Record<ElementType, ElementDef>> = Object.fromEntries(
    ELEMENTS.map((e) => [e.type, e]),
) as Record<ElementType, ElementDef>;

export function isTerrain(type: ElementType): type is TerrainType {
    return ELEMENT_BY_TYPE[type]?.layer === 'terrain';
}

export function elementsIn(category: ElementCategory): ElementDef[] {
    return ELEMENTS.filter((e) => e.category === category);
}

/** Per-tile surface friction for terrain (consumed by PlayScene / game-core surface modifiers). */
export const TERRAIN_FRICTION: Readonly<Record<TerrainType, number>> = {
    ground: 0.1,
    brick: 0.1,
    question: 0.1,
    ice: 0.002,
    slime: 0.6,
    oneway: 0.1,
    semisolid: 0.1,
};
