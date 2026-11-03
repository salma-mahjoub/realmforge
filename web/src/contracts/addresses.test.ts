import { describe, expect, it } from 'vitest';
import { zeroAddress } from 'viem';
import { getAddresses } from './addresses';

describe('getAddresses', () => {
    it('never reuses the env (local) addresses on another chain', () => {
        // vitest has no VITE_* env: the env pair is unset, so an unknown chain must come back empty
        expect(getAddresses(999_999)).toEqual({ levelNFT: zeroAddress, forgeCoin: zeroAddress });
    });
    it('returns the generated per-chain deployment for a known chain', () => {
        const sepolia = getAddresses(11155111);
        expect(sepolia.levelNFT).not.toBe(zeroAddress);
        expect(sepolia.forgeCoin).not.toBe(zeroAddress);
    });
});
