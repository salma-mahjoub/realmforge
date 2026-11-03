import { describe, expect, it } from 'vitest';
import { hashDomain } from 'viem';

const DOMAIN_TYPES = {
    EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
    ],
} as const;
import { permitDomain } from './useSettleRun';
import { humanizeError, isUserRejection } from '../../web3/errors';

const FORGE = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

describe('permitDomain', () => {
    // eip712Domain() of ForgeCoin: ERC20Permit("RealmForge ForgeCoin") while name() is "ForgeCoin".
    const eip712 = ['0x0f', 'RealmForge ForgeCoin', '1', 31337n, FORGE, '0x', []] as const;

    it('uses the contract EIP-712 domain name, not the ERC-20 name()', () => {
        expect(permitDomain(eip712, 31337, FORGE)).toEqual({ name: 'RealmForge ForgeCoin', version: '1', chainId: 31337, verifyingContract: FORGE });
    });

    it('hashes differently from a domain built with name() (the bug that made every permit invalid)', () => {
        const good = hashDomain({ domain: { ...permitDomain(eip712, 31337, FORGE), chainId: 31337n }, types: DOMAIN_TYPES });
        const bad = hashDomain({ domain: { name: 'ForgeCoin', version: '1', chainId: 31337n, verifyingContract: FORGE }, types: DOMAIN_TYPES });
        expect(good).not.toBe(bad);
    });
});

describe('isUserRejection', () => {
    it('is true only for a wallet rejection, never for a contract revert', () => {
        expect(isUserRejection(humanizeError({ code: 4001, message: 'User rejected the request.' }))).toBe(true);
        expect(isUserRejection(humanizeError({ data: { errorName: 'ERC20InsufficientAllowance' } }))).toBe(false);
        expect(isUserRejection('The contract rejected the transaction (RPC)')).toBe(false);
    });
});
