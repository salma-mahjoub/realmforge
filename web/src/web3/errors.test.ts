import { describe, expect, it } from 'vitest';
import { humanizeError } from './errors';

/** Minimal stand-ins for the viem error shapes (BaseError chains with `cause`). */
const err = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? '')), props);

describe('humanizeError', () => {
    it('recognises a wallet rejection anywhere in the cause chain', () => {
        expect(humanizeError(err({ message: 'tx failed', cause: err({ code: 4001, message: 'User rejected the request.' }) }))).toBe('You rejected the request in your wallet.');
        expect(humanizeError(err({ name: 'UserRejectedRequestError', message: 'x' }))).toBe('You rejected the request in your wallet.');
    });

    it('maps RealmForge and OpenZeppelin custom errors', () => {
        expect(humanizeError(err({ shortMessage: 'reverted', cause: err({ data: { errorName: 'FaucetAlreadyClaimed' } }) }))).toBe('You already claimed the faucet with this address.');
        expect(humanizeError(err({ message: 'The contract function "buy" reverted with the following reason: WrongPayment' }))).toBe('The price changed — refresh and try again.');
        expect(humanizeError(err({ message: 'Error: VM Exception: reverted with custom error ERC721NonexistentToken(1)' }))).toBe('This level NFT does not exist on this network.');
        expect(humanizeError(err({ cause: err({ data: { errorName: 'SomethingNew' } }) }))).toBe('The contract rejected the transaction (SomethingNew).');
    });

    it('explains funds, network and offline failures', () => {
        expect(humanizeError(err({ message: 'insufficient funds for gas * price + value' }))).toBe('Not enough ETH to pay for gas on this network.');
        expect(humanizeError(err({ message: 'TypeError: Failed to fetch' }))).toBe('Network unreachable — is the local chain / server running?');
        expect(humanizeError(err({ message: 'The current chain of the wallet (id: 1) does not match the target chain' }))).toBe('Your wallet is on another network — switch networks and retry.');
        expect(humanizeError(err({ message: 'returned no data ("0x")' }))).toBe('Contracts are not deployed on this network (or the address is wrong).');
    });

    it('turns API statuses into sentences and keeps unknown messages to one line', () => {
        expect(humanizeError(err({ status: 422, message: 'run rejected: not all checkpoints reached' }))).toBe('The server rejected the run: not all checkpoints reached');
        expect(humanizeError(err({ status: 400, message: 'invalid body' }))).toMatch(/refused the request data/);
        expect(humanizeError(err({ status: 503, message: 'down' }))).toBe('The game server failed (503). Try again in a moment.');
        expect(humanizeError(err({ message: 'first line\nsecond line' }))).toBe('first line');
        expect(humanizeError('plain string')).toBe('plain string');
        expect(humanizeError(null)).toBe('Something went wrong.');
    });
});
