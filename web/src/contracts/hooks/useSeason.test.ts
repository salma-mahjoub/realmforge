import { describe, expect, it } from 'vitest';
import { parseSeasonProof, prizeOf } from './useSeason';

describe('prizeOf', () => {
    it('computes pool * share / 10 000 like ForgeCoin.closeSeason (rounded down)', () => {
        expect(prizeOf(2n * 10n ** 18n, 5_000)).toBe(10n ** 18n);
        expect(prizeOf(10n, 3_333)).toBe(3n);
        expect(prizeOf(0n, 10_000)).toBe(0n);
    });
});

describe('parseSeasonProof', () => {
    const raw = {
        ranking: {},
        message: { season: '2', players: ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8'], creators: ['0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'], shares: ['5000', '5000'] },
        signature: '0xabc',
    };
    it('turns the server response into closeSeason arguments (share strings → bigint)', () => {
        expect(parseSeasonProof(raw)).toEqual({ players: raw.message.players, creators: raw.message.creators, shares: [5000n, 5000n], signature: '0xabc' });
    });
    it('refuses an incomplete response', () => {
        expect(parseSeasonProof(null)).toBeNull();
        expect(parseSeasonProof({ message: { players: [], creators: [], shares: [] } })).toBeNull(); // no signature
    });
});
