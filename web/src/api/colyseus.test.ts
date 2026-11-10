import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchMakeError } from 'colyseus.js';
import { RaceConnection, closeRoom, describeJoinError, needsSignIn, openRoom, stashConnection } from './colyseus';

const joinById = vi.fn();
vi.mock('colyseus.js', async (orig) => ({ ...(await orig<typeof import('colyseus.js')>()), Client: vi.fn(() => ({ joinById, create: joinById })) }));

// the real bus pulls in Phaser, which needs a browser
vi.mock('../game/EventBus', () => ({ EventBus: { subscribe: vi.fn(() => () => undefined), emit: vi.fn() } }));

const fake = (code: string) => {
    const leave = vi.fn(async () => undefined);
    return { conn: { code, leave } as unknown as RaceConnection, leave };
};

describe('openRoom / closeRoom (React StrictMode runs the lobby effect twice)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('keeps a handed-over room alive across the cleanup of the first effect run', async () => {
        const { conn, leave } = fake('AB2C');
        stashConnection(conn);
        const join = vi.fn();

        const first = await openRoom('AB2C:0x1', 'AB2C', join); // first run takes the host's connection
        closeRoom('AB2C:0x1'); // its cleanup
        const second = await openRoom('AB2C:0x1', 'AB2C', join); // second run, immediately

        expect(second).toBe(first);
        expect(join).not.toHaveBeenCalled(); // no "room not found" join attempt
        await vi.advanceTimersByTimeAsync(1000);
        expect(leave).not.toHaveBeenCalled();
    });

    it('leaves the room once the page is really closed', async () => {
        const { conn, leave } = fake('ZZ99');
        stashConnection(conn);
        await openRoom('ZZ99:0x1', 'ZZ99', vi.fn());
        closeRoom('ZZ99:0x1');
        await vi.advanceTimersByTimeAsync(1000);
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it('joins by code when nothing was handed over, and shares that join', async () => {
        const { conn } = fake('JN3K');
        const join = vi.fn(async () => conn);
        const [a, b] = await Promise.all([openRoom('JN3K:0x2', 'JN3K', join), openRoom('JN3K:0x2', 'JN3K', join)]);
        expect(a).toBe(b);
        expect(join).toHaveBeenCalledTimes(1);
        closeRoom('JN3K:0x2');
        await vi.advanceTimersByTimeAsync(1000);
    });
});

describe('room join with a SIWE session', () => {
    beforeEach(() => joinById.mockReset());
    const opts = { address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const, levelId: 1 };

    it('sends the session token, and signs in again once when the server refuses it', async () => {
        joinById.mockRejectedValueOnce(new MatchMakeError('sign-in expired or made with another wallet', 4401)).mockResolvedValueOnce({ roomId: 'AB2C' });
        const auth = { token: vi.fn(async () => 'old'), renew: vi.fn(async () => 'fresh') };
        const conn = await RaceConnection.joinByCode('AB2C', opts, auth);
        expect(conn.code).toBe('AB2C');
        expect(joinById.mock.calls.map((c) => c[1].token)).toEqual(['old', 'fresh']);
        expect(auth.renew).toHaveBeenCalledTimes(1);
    });

    it('does not retry other failures, and explains a refused signature', async () => {
        joinById.mockRejectedValueOnce(new MatchMakeError('room "ZZZZ" not found', 4212));
        const auth = { token: vi.fn(async () => 't'), renew: vi.fn(async () => 'x') };
        await expect(RaceConnection.joinByCode('ZZZZ', opts, auth)).rejects.toThrow(/not found/);
        expect(auth.renew).not.toHaveBeenCalled();

        const unsigned = new MatchMakeError('wallet signature required: sign in with Ethereum', 4401);
        expect(needsSignIn(unsigned)).toBe(true);
        expect(describeJoinError(unsigned)).toMatch(/prove they own their wallet .*wallet signature required/);
        const rejected = Object.assign(new Error('User rejected the request.'), { code: 4001 });
        expect(needsSignIn(rejected)).toBe(true);
        expect(describeJoinError(rejected)).toMatch(/declined the sign-in signature/);
        // Colyseus' own 4001 (invalid options) is not a wallet rejection
        expect(describeJoinError(new MatchMakeError('address: invalid wallet address', 4001))).toBe('address: invalid wallet address');
        expect(needsSignIn(new MatchMakeError('address: invalid wallet address', 4001))).toBe(false);
    });
});
