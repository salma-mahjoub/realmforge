/**
 * RealmForge level file format — `level.v1.json` (SPEC §3.4).
 *
 * The canonical JSON of this document is hashed (`keccak256`) and stored on-chain as
 * `LevelNFT.layoutHash`, so field order/serialisation must go through `canonicalize()`
 * in ./serialize.ts — never `JSON.stringify` a level ad-hoc before hashing.
 */

import type { ElementType as CoreElementType } from '@realmforge/game-core';

export const LEVEL_SCHEMA_VERSION = 1 as const;

/** Max level size (SPEC §3.3): 300 × 30 tiles. */
export const MAX_LEVEL_W = 300;
export const MAX_LEVEL_H = 30;

export type Theme = 'grass' | 'desert' | 'snow' | 'castle';
export const THEMES: readonly Theme[] = ['grass', 'desert', 'snow', 'castle'];

/** Element categories shown in the editor palette (SPEC §3.2). */
export type ElementCategory = 'terrain' | 'hazards' | 'dynamic' | 'moving' | 'enemies' | 'items' | 'flow';

/**
 * Element type names are game-core's canonical `ELEMENT_TYPES` (@realmforge/game-core, which
 * follow the asset manifest). Terrain types live in the RLE grid, everything else in entities[].
 */
export type TerrainType = 'ground' | 'brick' | 'question_block' | 'ice' | 'slime' | 'one_way' | 'semi_solid';
export type EntityType = Exclude<CoreElementType, TerrainType>;
export type ElementType = CoreElementType;

/**
 * Terrain byte values in `layers.terrain`. 0 = empty. Values are part of the on-chain-hashed
 * format: append only, never renumber.
 */
export const TERRAIN_IDS: Readonly<Record<TerrainType, number>> = {
    ground: 1,
    brick: 2,
    question_block: 3,
    ice: 4,
    slime: 5,
    one_way: 6,
    semi_solid: 7,
};

export const TERRAIN_BY_ID: Readonly<Record<number, TerrainType>> = Object.fromEntries(
    Object.entries(TERRAIN_IDS).map(([k, v]) => [v, k as TerrainType]),
);

/** Tile-space waypoint. */
export interface Waypoint {
    x: number;
    y: number;
}

/**
 * Per-entity properties = game-core `ELEMENT_PROPS[type]` descriptors (width/height/group/enabled,
 * speed in px/frame, direction ±1, timer in frames, link entity id, path in tile centres, …).
 * Only values that differ from the descriptor defaults need to be stored.
 */
export interface EntityProps {
    link?: number | string;
    path?: Waypoint[];
    [key: string]: unknown;
}

export interface LevelEntity {
    /** Unique within the level, > 0. */
    id: number;
    type: EntityType;
    /** Tile coordinates. */
    x: number;
    y: number;
    props?: EntityProps;
}

export interface LevelMeta {
    name: string;
    theme: Theme;
    /** Seconds. */
    timeLimit: number;
    music: string;
    description?: string;
    /** Token id of the remix source (mirrors on-chain `parentId`), 0/undefined = original. */
    parentId?: number;
}

export interface LevelSize {
    /** Width in tiles (≤ 300). */
    w: number;
    /** Height in tiles (≤ 30). */
    h: number;
    /** Tile size in px of the source tileset (render scale is derived from it). */
    tile: number;
}

export interface LevelLayers {
    /** RLE-encoded uint8 grid, row-major, w*h cells. See ./rle.ts for the encoding. */
    terrain: string;
}

/** The on-disk / IPFS document. */
export interface LevelFileV1 {
    schema: typeof LEVEL_SCHEMA_VERSION;
    meta: LevelMeta;
    size: LevelSize;
    layers: LevelLayers;
    entities: LevelEntity[];
    spawn: Waypoint;
    goal: Waypoint;
}

/** In-memory, decoded level used by the editor and scenes. */
export interface LevelDoc {
    meta: LevelMeta;
    size: LevelSize;
    /** Decoded terrain grid, length w*h, row-major. */
    terrain: Uint8Array;
    entities: LevelEntity[];
    spawn: Waypoint;
    goal: Waypoint;
}

/** NFT metadata JSON pinned next to the level file (tokenURI target). */
export interface LevelNftMetadata {
    name: string;
    description: string;
    image: string; // ipfs://<thumbnail CID>
    animation_url?: string;
    external_url?: string;
    attributes: { trait_type: string; value: string | number }[];
    properties: {
        level: string; // ipfs://<level.v1.json CID>
        layoutHash: `0x${string}`;
        schema: typeof LEVEL_SCHEMA_VERSION;
    };
}
