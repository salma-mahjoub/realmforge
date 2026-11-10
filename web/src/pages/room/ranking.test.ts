import { describe, expect, it } from 'vitest';
import { liveRanking, secondsUntil } from './ranking';

const p = (address: string, finishedMs?: number, progress?: number) => ({ address: address as `0x${string}`, finishedMs, progress });

describe('liveRanking', () => {
    it('orders finishers by time, then the rest by progress', () => {
        const order = liveRanking([p('0xa', undefined, 3), p('0xb', 2100), p('0xc', 1900), p('0xd', undefined, 9)]);
        expect(order.map((x) => x.address)).toEqual(['0xc', '0xb', '0xd', '0xa']);
    });
    it('follows the signed server ranking once there is one (case-insensitive)', () => {
        const order = liveRanking([p('0xAA', 1000), p('0xbb', 900)], ['0xaa', '0xBB']);
        expect(order.map((x) => x.address)).toEqual(['0xAA', '0xbb']);
    });
});

describe('secondsUntil', () => {
    it('counts down in whole seconds and clamps skew', () => {
        expect(secondsUntil(10_000, 7_100)).toBe(3);
        expect(secondsUntil(10_000, 8_500)).toBe(2);
        expect(secondsUntil(10_000, 10_200)).toBe(0);
        expect(secondsUntil(60_000, 0)).toBe(3); // client clock far behind
        expect(secondsUntil(0, 5)).toBe(3);
    });
});
