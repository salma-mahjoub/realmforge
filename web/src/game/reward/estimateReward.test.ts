import { describe, expect, it } from 'vitest';
import { estimateReward } from './estimateReward';

describe('estimateReward (mirrors ForgeCoin._computeReward)', () => {
    it('fresh level: base + first clear + record', () => {
        expect(estimateReward({ plays: 0, clears: 0, bestTimeMs: null }, { timeMs: 1660, coins: 0 })).toBe(35);
    });
    it('hard level, no bonuses: difficulty scales to the 50 cap', () => {
        expect(estimateReward({ plays: 10, clears: 1, bestTimeMs: 1000 }, { timeMs: 2000, coins: 0 })).toBe(45.5);
        expect(estimateReward({ plays: 4, clears: 0, bestTimeMs: 1000 }, { timeMs: 2000, coins: 0 })).toBe(70); // 50 + first clear
    });
    it('coin bonus is capped at 5', () => {
        expect(estimateReward({ plays: 2, clears: 2, bestTimeMs: 1000 }, { timeMs: 2000, coins: 3 })).toBe(5.3);
        expect(estimateReward({ plays: 2, clears: 2, bestTimeMs: 1000 }, { timeMs: 2000, coins: 999 })).toBe(10);
    });
    it('self-play and failed runs earn nothing', () => {
        expect(estimateReward({ plays: 0, clears: 0, bestTimeMs: null }, { timeMs: 1, coins: 0 }, true)).toBe(0);
        expect(estimateReward({ plays: 0, clears: 0, bestTimeMs: null }, { timeMs: 1, coins: 0, cleared: false })).toBe(0);
    });
});
