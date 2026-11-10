import type { Address, Hex } from 'viem';
import type { RunResult } from '../../contracts/hooks/types';

/**
 * Co-op helpers (SPEC §3.5), mirroring server/src/rooms/CoopRoom.ts + server/src/level/analysis.ts:
 * checkpoints are ordered like the server orders them, the team respawns at the furthest checkpoint
 * anyone reached (`sharedCheckpoint`), and the team clears when every active player reached the goal.
 */

interface CheckpointEntity {
    id: number;
    type: string;
    x: number;
    y: number;
    props?: Record<string, unknown>;
}

/** Same order as the server's `analyzeLevel`: `props.order` when set, else x, then id. */
export function orderedCheckpoints<E extends CheckpointEntity>(entities: readonly E[]): E[] {
    return entities
        .filter((e) => e.type === 'checkpoint')
        .map((e) => ({ e, order: typeof e.props?.order === 'number' ? (e.props.order as number) : e.x }))
        .sort((a, b) => a.order - b.order || a.e.x - b.e.x || a.e.id - b.e.id)
        .map(({ e }) => e);
}

/** Where a teammate reappears after a fall: the furthest shared checkpoint, or the level spawn. */
export function respawnPoint(entities: readonly CheckpointEntity[], shared: number, spawn: { x: number; y: number }): { x: number; y: number } {
    const cp = shared >= 0 ? orderedCheckpoints(entities)[shared] : undefined;
    return cp ? { x: cp.x, y: cp.y } : { x: spawn.x, y: spawn.y };
}

/** Checkpoint ids that count as reached for this player: its own touches plus everything up to the shared index. */
export function reachedCheckpointIds(entities: readonly CheckpointEntity[], shared: number, touched: Iterable<number>): Set<number> {
    const ids = new Set(touched);
    orderedCheckpoints(entities).forEach((e, i) => i <= shared && ids.add(e.id));
    return ids;
}

export interface TeamMember {
    address: string;
    finished: boolean;
    /** Server-timed finish (ms since GO), 0 if not finished. */
    finishTimeMs: number;
    connected?: boolean;
    gaveUp?: boolean;
    disqualified?: boolean;
}

export interface TeamSummary {
    /** Everyone still in the team reached the goal (the server's `everyoneCleared`). */
    cleared: boolean;
    /** When the last teammate reached the goal: the team's clear time. */
    teamTimeMs: number | null;
    /** Sum of every finisher's time. */
    combinedMs: number;
    finishers: number;
    total: number;
}

/** Team result, as the server decides it: disconnected players do not hold the team back; quitters do. */
export function teamSummary(members: readonly TeamMember[]): TeamSummary {
    const finished = members.filter((m) => m.finished);
    const cleared = members.length > 0 && members.every((m) => m.finished || m.connected === false);
    const times = finished.map((m) => m.finishTimeMs);
    return {
        cleared,
        teamTimeMs: cleared && times.length ? Math.max(...times) : null,
        combinedMs: times.reduce((a, b) => a + b, 0),
        finishers: finished.length,
        total: members.length,
    };
}

export interface SignedCoopResult {
    result: RunResult;
    signature: Hex;
    signer?: Address;
}

export interface CoopResultMessage {
    signed: SignedCoopResult | null;
    cleared: boolean;
    error?: string;
}

/** The room's `result` message: a signed RunResult per player, or `{cleared, error}` for an unpublished level. */
export function parseCoopResult(message: unknown): CoopResultMessage | null {
    const m = message as {
        kind?: string;
        cleared?: boolean;
        error?: string;
        signature?: string;
        signer?: string;
        result?: { player?: string; levelId?: string | number; timeMs?: number; cleared?: boolean; coins?: number; nonce?: string | number; deadline?: string | number };
    } | null;
    if (!m || typeof m !== 'object') return null;
    const r = m.result;
    if (r && m.signature && r.player && r.levelId !== undefined && r.nonce !== undefined && r.deadline !== undefined) {
        const result: RunResult = {
            player: r.player as Address,
            levelId: BigInt(r.levelId),
            timeMs: Number(r.timeMs ?? 0),
            cleared: Boolean(r.cleared),
            coins: Number(r.coins ?? 0),
            nonce: BigInt(r.nonce),
            deadline: BigInt(r.deadline),
        };
        return { signed: { result, signature: m.signature as Hex, signer: m.signer as Address | undefined }, cleared: result.cleared };
    }
    if (m.kind === 'coop' || m.error) return { signed: null, cleared: Boolean(m.cleared), error: m.error };
    return null;
}
