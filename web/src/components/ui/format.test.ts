import { describe, expect, it } from 'vitest';
import { capitalize, compact, formatAmount, formatMs, hex, pct, shortAddr, timeAgo } from './format';

describe('format helpers', () => {
    it('shortens addresses and hashes', () => {
        expect(shortAddr('0x7a3c5e2b9d14f08a6e1c3b7d5f9a2e4c6b8d91c4')).toBe('0x7a3c…91c4');
        expect(shortAddr('0xabc')).toBe('0xabc');
        expect(shortAddr(undefined)).toBe('—');
        expect(shortAddr('0x7a3c5e2b9d14f08a6e1c3b7d5f9a2e4c6b8d91c4', 10, 8)).toBe('0x7a3c5e2b…6b8d91c4');
    });

    it('formats run times as mm:ss.cc', () => {
        expect(formatMs(58120)).toBe('00:58.12');
        expect(formatMs(83450)).toBe('01:23.45');
        expect(formatMs(0)).toBe('00:00.00');
        expect(formatMs(null)).toBe('—');
        expect(formatMs(Number.NaN)).toBe('—');
    });

    it('compacts counts and formats amounts', () => {
        expect(compact(842)).toBe('842');
        expect(compact(1200)).toBe('1.2k');
        expect(compact(2000)).toBe('2k');
        expect(compact(1_500_000)).toBe('1.5M');
        expect(formatAmount('1240')).toBe('1,240');
        expect(formatAmount(0.123456, 4)).toBe('0.1235');
        expect(formatAmount('')).toBe('—');
        expect(formatAmount('abc')).toBe('abc');
    });

    it('formats percentages, colours and labels', () => {
        expect(pct(0.124)).toBe('12%');
        expect(pct(Number.NaN)).toBe('—');
        expect(hex(0x7c5cff)).toBe('#7c5cff');
        expect(hex(0xff)).toBe('#0000ff');
        expect(capitalize('snow')).toBe('Snow');
    });

    it('describes elapsed time', () => {
        const now = Date.parse('2026-10-31T12:00:00Z');
        expect(timeAgo(now - 10_000, now)).toBe('just now');
        expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago');
        expect(timeAgo(now - 3 * 3600_000, now)).toBe('3h ago');
        expect(timeAgo(new Date(now - 2 * 86400_000), now)).toBe('2d ago');
    });
});
