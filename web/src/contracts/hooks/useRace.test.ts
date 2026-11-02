import { describe, expect, it } from 'vitest';
import { keccak256, toHex } from 'viem';
import { parseRaceResult, raceIdFor } from './useRace';

describe('raceIdFor', () => {
    it('uses the same rule as the server (keccak256 of the room code bytes)', () => {
        expect(raceIdFor('K7Q2')).toBe(keccak256(toHex('K7Q2')));
        expect(raceIdFor('K7Q2')).toHaveLength(66);
    });
    it('gives distinct ids to distinct rooms', () => {
        expect(raceIdFor('AAAA')).not.toBe(raceIdFor('AAAB'));
    });
});

describe('parseRaceResult', () => {
    const msg = {
        kind: 'race',
        result: { roomId: raceIdFor('K7Q2'), ranking: ['0x70997970C51812dc3A010C7d01b50e0d17dc79C8', '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'], deadline: '1900000000' },
        signature: '0xabcdef',
        signer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    };
    it('turns the room broadcast into settleRace arguments (deadline string → bigint)', () => {
        const r = parseRaceResult(msg);
        expect(r).toEqual({ roomId: msg.result.roomId, ranking: msg.result.ranking, deadline: 1_900_000_000n, signature: '0xabcdef' });
    });
    it('rejects an incomplete broadcast instead of sending a bad transaction', () => {
        expect(parseRaceResult(null)).toBeNull();
        expect(parseRaceResult({ result: { roomId: '0x1', ranking: [] }, signature: '0x1' })).toBeNull(); // no deadline
        expect(parseRaceResult({ result: { roomId: '0x1', ranking: [], deadline: '1' } })).toBeNull(); // no signature
    });
});
