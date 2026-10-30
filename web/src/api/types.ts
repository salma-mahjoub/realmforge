import type { Address, Hex } from 'viem';
import type { LevelFileV1, LevelNftMetadata, Theme } from '../game/level/types';

/** API response shapes (server/ Fastify + indexer, SPEC §7). Provisional until server/ freezes its routes. */

export type LevelSort = 'new' | 'popular' | 'hardest';

export interface LevelSummary {
    id: number;
    name: string;
    theme: Theme;
    creator: Address;
    /** FORGE, decimal string */
    playFee: string;
    plays: number;
    /** clears / plays, 0..1 */
    clearRate: number;
    likes: number;
    bestTimeMs: number | null;
    createdAt: string;
    listedPriceEth: string | null;
    /** IPFS CID of level.v1.json */
    cid: string;
    thumbnailUrl?: string;
}

export interface LevelDetail extends LevelSummary {
    owner: Address;
    royaltyBps: number;
    layoutHash: Hex;
    parentId: number;
    clears: number;
    creatorEarned: string;
    metadata?: LevelNftMetadata;
}

export interface LeaderboardEntry {
    rank: number;
    player: Address;
    timeMs: number;
    txHash?: Hex | string;
}

export interface RecentTx {
    kind: 'Play fee' | 'New record' | 'Listed' | 'Sold' | 'Published' | 'Clear';
    hash: Hex | string;
    status: 'Confirmed' | 'Pending' | 'Failed';
    ago: string;
}

export interface Listing {
    level: LevelSummary;
    seller: Address;
    priceEth: string;
    royaltyBps: number;
    listedAgo: string;
}

export interface ProfileSummary {
    address: Address;
    forgeBalance: string;
    clears: number;
    plays: number;
    bestRank: number | null;
    created: LevelSummary[];
    owned: LevelSummary[];
    recentClears: { level: LevelSummary; timeMs: number; reward: string; ago: string }[];
}

export interface RoomPlayer {
    sessionId: string;
    address: Address;
    color: number;
    stakePaid: boolean;
    ready: boolean;
    isYou?: boolean;
    finishedMs?: number;
}

// ── request/response for write endpoints ──────────────────────────────────────────────────────

export interface PinRequest {
    level: LevelFileV1;
    /** data:image/png;base64,… from game.renderer.snapshot */
    thumbnail: string;
    name: string;
    description: string;
}
export interface PinResponse {
    levelCid: string;
    imageCid: string;
    metadataUri: string; // ipfs://…
    layoutHash: Hex;
}

export interface ClearProofRequest {
    creator: Address;
    level: LevelFileV1;
    timeMs: number;
    inputs: Array<[number, number]>;
}
export interface ClearProofResponse {
    layoutHash: Hex;
    deadline: string; // uint256 as decimal string
    signature: Hex;
}

export interface SubmitRunRequest {
    player: Address;
    levelId: number;
    timeMs: number;
    coins: number;
    cleared: boolean;
    inputs: Array<[number, number]>;
}
export interface SubmitRunResponse {
    result: { player: Address; levelId: string; timeMs: number; cleared: boolean; coins: number; nonce: string; deadline: string };
    signature: Hex;
}
