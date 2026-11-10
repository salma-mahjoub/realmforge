import { describe, expect, it } from 'vitest';
import { sampleGhostTrace } from './ghost';

describe('ghost trace timeline', () => {
    const trace = [{ f: 0, x: 1, y: 2 }, { f: 4, x: 5, y: 6 }, { f: 10, x: 11, y: 0 }];
    it('interpolates by fixed physics frame across sampled trace gaps', () => {
        expect(sampleGhostTrace(trace, 2)).toEqual({ f: 2, x: 3, y: 4 });
        expect(sampleGhostTrace(trace, 7)).toEqual({ f: 7, x: 8, y: 3 });
    });
    it('returns exact samples and stops outside the recorded run', () => {
        expect(sampleGhostTrace(trace, 4)).toEqual(trace[1]);
        expect(sampleGhostTrace(trace, -1)).toBeNull();
        expect(sampleGhostTrace(trace, 11)).toBeNull();
        expect(sampleGhostTrace([], 0)).toBeNull();
    });
});
