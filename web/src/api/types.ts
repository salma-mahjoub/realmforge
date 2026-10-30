import type { Address, Hex } from 'viem';
import type { LevelFileV1, LevelNftMetadata, Theme } from '../game/level/types';
import type { RunSubmission } from '../game/run';

/** API shapes. Read models are what pages render; `LevelRow` etc. are the raw server/ responses. */

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

// ── request/response for write endpoints (server/src/api/routes, server/src/api/schemas.ts) ──

/** POST /levels/pin */
export interface PinRequest {
    level: LevelFileV1;
    /** data:image/png;base64,… from game.renderer.snapshot */
    thumbnail?: string;
    description?: string;
}
export interface PinResponse {
    layoutHash: Hex;
    levelCid: string;
    thumbnailCid: string | null;
    metadataCid: string;
    /** ipfs://<metadataCid> — pass to LevelNFT.publish */
    tokenURI: string;
    minTimeMs: number;
    provider: string;
    alreadyPublished: boolean;
}

/** POST /levels/clear-proof (level must be pinned first). */
export interface ClearProofRequest {
    creator: Address;
    layoutHash: Hex;
    run: RunSubmission;
}
export interface ClearProofResponse {
    proof: { creator: Address; layoutHash: Hex; deadline: string };
    signature: Hex;
    signer: Address;
    tokenURI: string | null;
}

/** POST /runs/validate */
export interface SubmitRunRequest {
    player: Address;
    levelId: number;
    run: RunSubmission;
}
export interface SubmitRunResponse {
    result: { player: Address; levelId: string; timeMs: number; cleared: boolean; coins: number; nonce: string; deadline: string };
    signature: Hex;
    signer: Address;
}

/** 422 body of clear-proof / runs/validate. */
export interface RunRejected {
    error: string;
    issues?: { code: string; message: string; frame?: number }[];
}

/** Row of GET /levels and GET /levels/:id (SQLite indexer, snake_case). */
export interface LevelRow {
    id: number;
    creator: string;
    owner: string;
    layout_hash: string;
    parent_id: number;
    play_fee: string;
    active: number;
    plays: number;
    clears: number;
    likes: number;
    best_time_ms: number | null;
    best_player: string | null;
    listing_price: string | null;
    created_at: number;
    tx_hash: string;
    level_cid: string | null;
    metadata_cid: string | null;
    thumbnail_cid: string | null;
    min_time_ms: number | null;
    name: string | null;
    theme: string | null;
}
