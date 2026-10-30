import type { Address, Hex } from 'viem';

/** Mirror of `LevelNFT.Level` (SPEC §4.1). */
export interface OnChainLevel {
    id: bigint;
    owner?: Address;
    creator: Address;
    layoutHash: Hex;
    parentId: bigint;
    playFee: bigint;
    plays: number;
    clears: number;
    likes: number;
    bestTimeMs: number;
    bestPlayer: Address;
    active: boolean;
}

/** EIP-712 `RunResult` signed by the game server (SPEC §5.2). */
export interface RunResult {
    player: Address;
    levelId: bigint;
    timeMs: number;
    cleared: boolean;
    coins: number;
    nonce: bigint;
    deadline: bigint;
}

export interface PublishArgs {
    layoutHash: Hex;
    /** ipfs://… metadata URI */
    uri: string;
    /** FORGE units (18 decimals), ≤ MAX_PLAY_FEE (100e18) */
    playFee: bigint;
    parentId: bigint;
    deadline: bigint;
    /** Server-signed EIP-712 ClearProof{creator, layoutHash, deadline} */
    clearSig: Hex;
}

export type TxPhase = 'idle' | 'signing' | 'pending' | 'confirmed' | 'error';
