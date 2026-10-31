/**
 * Editor palette catalog (SPEC §3.2). Element types and editable properties come from
 * game-core (`ELEMENT_TYPES` / `ELEMENT_PROPS`), so the palette, the property panel and the
 * runtime factories (`ELEMENTS[type].create`) can never disagree. This file only adds editor
 * presentation: label, palette category, placeholder colour and editor-side defaults.
 */
import { ELEMENT_PROPS, ELEMENT_TYPES, type PropDescriptor } from '@realmforge/game-core';
import type { ElementCategory, ElementType, EntityProps, TerrainType } from './types';
import { TERRAIN_IDS } from './types';

export type PropKind = PropDescriptor['kind'];

/** Property-panel row, derived 1:1 from a game-core `PropDescriptor`. */
export interface PropSpec {
    key: string;
    label: string;
    kind: PropKind;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
    default: unknown;
}

export interface ElementDef {
    type: ElementType;
    label: string;
    category: ElementCategory;
    /** Terrain goes into the RLE grid, everything else into entities[]. */
    layer: 'terrain' | 'entity';
    /** Placeholder colour (used when no texture from /assets/manifest.json is available). */
    color: number;
    /** Default footprint in tiles (game-core width/height defaults, overridable per entity). */
    w?: number;
    h?: number;
    /** Only one per level (start/goal). */
    unique?: boolean;
    /** Props written on placement (only where the editor wants something other than game-core's default). */
    defaults?: EntityProps;
    props: readonly PropSpec[];
}

interface Presentation {
    label: string;
    category: ElementCategory;
    color: number;
    unique?: boolean;
    defaults?: EntityProps;
}

const P: Record<ElementType, Presentation> = {
    ground: { label: 'Ground', category: 'terrain', color: 0x8b5a2b },
    brick: { label: 'Brick', category: 'terrain', color: 0xc0583a },
    question_block: { label: 'Question Block', category: 'terrain', color: 0xffc83d },
    ice: { label: 'Ice', category: 'terrain', color: 0x9fe3ff },
    slime: { label: 'Slime', category: 'terrain', color: 0x6ddc5a },
    one_way: { label: 'One-way Platform', category: 'terrain', color: 0xb08a5a },
    semi_solid: { label: 'Semi-solid', category: 'terrain', color: 0xd9b48a },
    spikes: { label: 'Spikes', category: 'hazards', color: 0xcfd6e6 },
    lava: { label: 'Lava', category: 'hazards', color: 0xff5a1f },
    saw: { label: 'Saw', category: 'hazards', color: 0x9aa3b5, defaults: { speed: 6 } },
    falling_block: { label: 'Falling Block', category: 'hazards', color: 0x7a7f8f },
    crate: { label: 'Crate', category: 'dynamic', color: 0xb7793e },
    seesaw: { label: 'Seesaw', category: 'dynamic', color: 0x8d6e4f, defaults: { length: 6 } },
    pendulum_ball: { label: 'Wrecking Ball', category: 'dynamic', color: 0x4b5263 },
    chain_bridge: { label: 'Chain Bridge', category: 'dynamic', color: 0x9b6b3d, defaults: { length: 6 } },
    spring: { label: 'Spring', category: 'dynamic', color: 0xe23b4e },
    conveyor_belt: { label: 'Conveyor Belt', category: 'dynamic', color: 0x5c6370, defaults: { width: 4 } },
    moving_platform: { label: 'Platform', category: 'moving', color: 0x7cc7ff, defaults: { width: 3, speed: 2 } },
    elevator: { label: 'Elevator', category: 'moving', color: 0x8fa3bf, defaults: { width: 3, speed: 2 } },
    rotating_platform: { label: 'Rotator', category: 'moving', color: 0xa0a8b8, defaults: { width: 3 } },
    walker: { label: 'Walker', category: 'enemies', color: 0xe0464e },
    shell: { label: 'Shell', category: 'enemies', color: 0x3fbf7f },
    flyer: { label: 'Flyer', category: 'enemies', color: 0xd94ad0 },
    jumper: { label: 'Jumper', category: 'enemies', color: 0xff8a3d },
    cannon: { label: 'Cannon', category: 'enemies', color: 0x2b2f3a },
    mushroom: { label: 'Super Mushroom', category: 'items', color: 0xe85165 },
    coin: { label: 'Coin', category: 'items', color: 0xffc83d },
    big_coin: { label: 'Big Coin', category: 'items', color: 0xffb000 },
    key: { label: 'Key', category: 'items', color: 0xffe066 },
    powerup_double_jump: { label: 'Double Jump', category: 'items', color: 0x7c5cff },
    powerup_dash: { label: 'Dash', category: 'items', color: 0x22d3ee },
    start: { label: 'Start', category: 'flow', color: 0x4ade80, unique: true },
    checkpoint: { label: 'Checkpoint', category: 'flow', color: 0x60a5fa },
    goal: { label: 'Goal Flag', category: 'flow', color: 0x7c5cff, unique: true },
    door: { label: 'Door', category: 'flow', color: 0x9b6b3d },
    pipe: { label: 'Pipe', category: 'flow', color: 0x22c55e },
    locked_door: { label: 'Key-lock Door', category: 'flow', color: 0xa16207 },
    switch: { label: 'Switch', category: 'flow', color: 0xf43f5e },
    switch_block: { label: 'Switch Block', category: 'flow', color: 0xf97316, defaults: { group: 'A' } },
};

const UNITS: Record<string, string> = {
    width: 'tiles',
    height: 'tiles',
    length: 'tiles',
    distance: 'tiles',
    amplitude: 'tiles',
    speed: 'px/frame',
    timer: 'frames',
    period: 'frames',
    launch: 'ref px/frame',
};

const label = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function propSpec(d: PropDescriptor): PropSpec {
    const step = d.kind !== 'number' ? undefined : d.name === 'direction' ? 2 : (d.max ?? 0) - (d.min ?? 0) <= 4 ? 0.1 : 1;
    return { key: d.name, label: label(d.name), kind: d.kind, unit: UNITS[d.name], min: d.min, max: d.max, step, default: d.default };
}

const TERRAIN = new Set<string>(Object.keys(TERRAIN_IDS));

export const ELEMENTS: readonly ElementDef[] = ELEMENT_TYPES.map((type) => {
    const p = P[type];
    const props = ELEMENT_PROPS[type].map(propSpec);
    const dflt = (k: string) => Number((p.defaults?.[k] as number | undefined) ?? ELEMENT_PROPS[type].find((d) => d.name === k)?.default ?? 1);
    return {
        type,
        label: p.label,
        category: p.category,
        layer: TERRAIN.has(type) ? 'terrain' : 'entity',
        color: p.color,
        w: dflt('width') * (type === 'seesaw' ? dflt('length') : 1),
        h: dflt('height'),
        unique: p.unique,
        defaults: p.defaults,
        props,
    } satisfies ElementDef;
});

export const CATEGORIES: readonly { id: ElementCategory; label: string; icon: string }[] = [
    { id: 'terrain', label: 'Terrain', icon: '▲' },
    { id: 'hazards', label: 'Hazards', icon: '⚠' },
    { id: 'dynamic', label: 'Dynamic', icon: '⚙' },
    { id: 'moving', label: 'Moving', icon: '⇄' },
    { id: 'enemies', label: 'Enemies', icon: '☠' },
    { id: 'items', label: 'Items', icon: '◆' },
    { id: 'flow', label: 'Flow', icon: '⚑' },
];

export const ELEMENT_BY_TYPE: Readonly<Record<ElementType, ElementDef>> = Object.fromEntries(
    ELEMENTS.map((e) => [e.type, e]),
) as Record<ElementType, ElementDef>;

export function isTerrain(type: ElementType): type is TerrainType {
    return TERRAIN.has(type);
}

export function elementsIn(category: ElementCategory): ElementDef[] {
    return ELEMENTS.filter((e) => e.category === category);
}
