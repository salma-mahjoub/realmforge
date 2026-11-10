/**
 * Client-side estimate of the FORGE a cleared run mints. Mirrors `ForgeCoin._computeReward`:
 *   min(BASE + 45 * (1 - clears/plays), 50)   (difficulty is 0 on a level nobody played yet)
 *   + FIRST_CLEAR_BONUS if nobody cleared it yet
 *   + RECORD_BONUS if this time beats the record (or there is none)
 *   + min(coins * 0.1, 5)
 * The owner playing their own level earns nothing. On-chain, the daily mint cap can still clip it,
 * hence "est." in the UI.
 */
export const REWARD = { base: 5, maxClear: 50, firstClear: 20, record: 10, perCoin: 0.1, maxCoin: 5 } as const;

export interface RewardStats {
    plays: number;
    clears: number;
    bestTimeMs: number | null;
}

export function estimateReward(stats: RewardStats, run: { timeMs: number; coins: number; cleared?: boolean }, selfPlay = false): number {
    if (run.cleared === false || selfPlay) return 0;
    let reward: number = REWARD.base;
    if (stats.plays > 0) reward += ((REWARD.maxClear - REWARD.base) * Math.max(0, stats.plays - stats.clears)) / stats.plays;
    reward = Math.min(reward, REWARD.maxClear);
    if (stats.clears === 0) reward += REWARD.firstClear;
    if (!stats.bestTimeMs || run.timeMs < stats.bestTimeMs) reward += REWARD.record;
    reward += Math.min(run.coins * REWARD.perCoin, REWARD.maxCoin);
    return Math.round(reward * 10) / 10;
}
