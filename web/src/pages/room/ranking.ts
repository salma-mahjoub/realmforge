import type { RoomPlayer } from '../../api/types';

/**
 * Live race order shown on the stage. Once the server has signed a result, its ranking is the truth;
 * before that: finishers by server-timed finish, then everyone else by progress (furthest right first),
 * which is also how the server ranks players who do not finish.
 */
export function liveRanking<P extends Pick<RoomPlayer, 'address' | 'finishedMs' | 'progress'>>(players: P[], ranking?: readonly string[] | null): P[] {
    if (ranking?.length) {
        const pos = new Map(ranking.map((a, i) => [a.toLowerCase(), i]));
        const at = (p: P) => pos.get(p.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
        return [...players].sort((a, b) => at(a) - at(b));
    }
    return [...players].sort((a, b) => {
        const fa = a.finishedMs ?? Infinity;
        const fb = b.finishedMs ?? Infinity;
        if (fa !== fb) return fa - fb;
        return (b.progress ?? 0) - (a.progress ?? 0);
    });
}

/** Whole seconds left before `startAt` (server epoch ms), kept within 0..max against clock skew. */
export function secondsUntil(startAt: number, now: number, max = 3): number {
    if (!Number.isFinite(startAt) || startAt <= 0) return max;
    return Math.max(0, Math.min(max, Math.ceil((startAt - now) / 1000)));
}
