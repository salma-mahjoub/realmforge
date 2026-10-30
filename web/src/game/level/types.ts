/**
 * RealmForge level file format — `level.v1.json` (SPEC §3.4).
 *
 * The canonical JSON of this document is hashed (`keccak256`) and stored on-chain as
 * `LevelNFT.layoutHash`, so field order/serialisation must go through `canonicalize()`
 * in ./serialize.ts — never `JSON.stringify` a level ad-hoc before hashing.
 */

export const LEVEL_SCHEMA_VERSION = 1 as const;

/** Max level size (SPEC §3.3): 300 × 30 tiles. */
export const MAX_LEVEL_W = 300;
export const MAX_LEVEL_H = 30;

export type Theme = 'grass' | 'desert' | 'snow' | 'castle';
export const THEMES: readonly Theme[] = ['grass', 'desert', 'snow', 'castle'];

/** Element categories shown in the editor palette (SPEC §3.2). */
export type ElementCategory = 'terrain' | 'hazards' | 'dynamic' | 'moving' | 'enemies' | 'items' | 'flow';

/** Terrain element ids (stored in the RLE terrain layer, one byte per tile). */
export type TerrainType =
    | 'ground'
    | 'brick'
    | 'question'
    | 'ice'
    | 'slime'
    | 'oneway'
    | 'semisolid';

export type HazardType = 'spikes' | 'lava' | 'saw' | 'falling_block';
export type DynamicType = 'crate' | 'seesaw' | 'pendulum' | 'chain_bridge' | 'spring' | 'conveyor';
export type MovingType = 'moving_platform' | 'elevator' | 'rotating_platform';
export type EnemyType = 'walker' | 'shell' | 'flyer' | 'jumper' | 'cannon';
export type ItemType = 'coin' | 'big_coin' | 'key' | 'powerup_double_jump' | 'powerup_dash';
export type FlowType = 'start' | 'checkpoint' | 'goal' | 'door' | 'pipe' | 'lock_door' | 'switch';

/** Everything that is not terrain lives in `entities[]`. */
export type EntityType = HazardType | DynamicType | MovingType | EnemyType | ItemType | FlowType;
export type ElementType = TerrainType | EntityType;

/**
 * Terrain byte values in `layers.terrain`. 0 = empty. Values are part of the on-chain-hashed
 * format: append only, never renumber.
 */
export const TERRAIN_IDS: Readonly<Record<TerrainType, number>> = {
    ground: 1,
    brick: 2,
    question: 3,
    ice: 4,
    slime: 5,
    oneway: 6,
    semisolid: 7,
};

export const TERRAIN_BY_ID: Readonly<Record<number, TerrainType>> = Object.fromEntries(
    Object.entries(TERRAIN_IDS).map(([k, v]) => [v, k as TerrainType]),
);

export type Direction = 'left' | 'right' | 'up' | 'down';

/** Tile-space waypoint. */
export interface Waypoint {
    x: number;
    y: number;
}

/**
 * Editable per-entity properties (SPEC §3.2: speed, direction, path, link target, timer).
 * Element-specific keys are allowed (e.g. seesaw `length`), hence the index signature.
 */
export interface EntityProps {
    /** px/s */
    speed?: number;
    direction?: Direction;
    /** Waypoints for moving platforms / flyers, tile coordinates. */
    path?: Waypoint[];
    loop?: boolean;
    motion?: 'linear' | 'ease';
    /** Entity id this one links to (door↔door, pipe↔pipe, switch→blocks, key→lock). */
    link?: number;
    /** Generic timer in ms (cannon fire rate, falling-block delay, switch duration…). */
    timer?: number;
    /** Start delay in ms. */
    delay?: number;
    rotation?: 0 | 90 | 180 | 270;
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
