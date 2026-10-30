import { describe, expect, it } from 'vitest';
import { createReplay, decodeInput, encodeInput, recordInput, EMPTY_INPUT } from '@realmforge/game-core';
import { changePairs, decodeInputLog, encodeInputLog, expandPairs } from './run';

describe('input log (game-core replay bitmask)', () => {
    it('round-trips through change pairs and base64', () => {
        const replay = createReplay();
        const right = { ...EMPTY_INPUT, right: true };
        const jump = { ...right, jump: true };
        for (let i = 0; i < 30; i++) recordInput(replay, i < 10 ? EMPTY_INPUT : i < 20 ? right : jump);
        expect(changePairs(replay)).toEqual([
            [0, 0],
            [10, encodeInput(right)],
            [20, encodeInput(jump)],
        ]);
        expect(decodeInput(encodeInput(jump))).toEqual(jump);
        expect(expandPairs(changePairs(replay), 30)).toEqual(replay);
        expect(decodeInputLog(encodeInputLog(replay))).toEqual(replay);
    });
});
