import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, type Address, type Log } from 'viem';
import { forgeCoinAbi } from '../generated';
import { formatCountdown, parseSeasonProof, payoutsFromReceipt, prizeOf, secondsLeft } from './useSeason';

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

describe('payoutsFromReceipt', () => {
    const coin = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as Address;
    const other = '0x5FbDB2315678afecb367f032d93F642f64180aa3' as Address;
    const P = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
    const C = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address;
    const transfer = (address: Address, from: Address, to: Address, value: bigint) =>
        ({
            address,
            topics: encodeEventTopics({ abi: forgeCoinAbi, eventName: 'Transfer', args: { from, to } }),
            data: encodeAbiParameters([{ type: 'uint256' }], [value]),
            blockHash: null, blockNumber: null, logIndex: null, transactionHash: null, transactionIndex: null, removed: false,
        }) as unknown as Log<bigint, number, false>;
    const proof = { players: [P], creators: [C], shares: [6000n, 4000n], signature: '0x' as const };

    it('labels the transfers out of ForgeCoin as player/creator payouts, ignoring other logs', () => {
        const logs = [
            transfer(coin, P, C, 1n), // between users
            transfer(coin, coin, P, 600n),
            transfer(other, other, P, 5n), // another contract
            transfer(coin, coin, C, 400n),
        ];
        expect(payoutsFromReceipt({ logs }, coin, proof)).toEqual([
            { kind: 'player', rank: 1, address: P, amount: 600n, shareBps: 6000n },
            { kind: 'creator', rank: 1, address: C, amount: 400n, shareBps: 4000n },
        ]);
    });
    it('returns nothing when the season had no winner', () => {
        expect(payoutsFromReceipt({ logs: [] }, coin, { players: [], creators: [], shares: [], signature: '0x' })).toEqual([]);
    });
});

describe('countdown', () => {
    it('formatCountdown always shows seconds and says "ended" at zero', () => {
        expect(formatCountdown(30 * 86400)).toBe('30d 0h 00m 00s');
        expect(formatCountdown(3 * 3600 + 5 * 60 + 9)).toBe('3h 05m 09s');
        expect(formatCountdown(61.7)).toBe('1m 01s');
        expect(formatCountdown(0)).toBe('ended');
        expect(formatCountdown(-5)).toBe('ended');
    });
    it('secondsLeft follows the chain clock (fast-forwarded) and keeps ticking with wall time', () => {
        // the chain is 30 days ahead of the wall clock after `npm run season:ff`
        expect(secondsLeft(1_000, 990, 50_000, 50_000)).toBe(10);
        expect(secondsLeft(1_000, 990, 50_000, 54_000)).toBe(6);
        expect(secondsLeft(1_000, 990, 50_000, 70_000)).toBe(-10);
        // no block yet: fall back to the wall clock
        expect(secondsLeft(100, undefined, 0, 40_000)).toBe(60);
    });
});
