import { describe, expect, it } from 'vitest';
import { isMocked, markLive, markMock } from './dataSource';

describe('sample-data tracking', () => {
    it('normalises numeric ids and wallet addresses so pages can ask by route pattern', () => {
        markMock('/profiles/0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC');
        markMock('/levels/42/activity');
        expect(isMocked('/profiles/:address')).toBe(true);
        expect(isMocked('/levels/:id/activity')).toBe(true);
        markLive('/profiles/0x90F79bf6EB2c4f870365E785982E1f101E93b906');
        markLive('/levels/7/activity');
        expect(isMocked('/profiles/:address')).toBe(false);
        expect(isMocked('/levels/:id/activity')).toBe(false);
    });
});
