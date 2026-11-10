import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { parseSiweMessage } from 'viem/siwe';
import { clearSession, ensureSession, getSession, saveSession, signInWithEthereum, subscribeSessions } from './siwe';

/** PUBLIC Hardhat test key #2 — test-only. */
const wallet = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const A = wallet.address;

function memoryStorage() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('SIWE client', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        vi.stubGlobal('localStorage', memoryStorage());
        vi.stubGlobal('window', { location: { host: 'localhost:8080', origin: 'http://localhost:8080' } });
        fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            if (url.endsWith('/auth/nonce')) return new Response(JSON.stringify({ nonce: 'abcdefgh12345678', expiresAt: Date.now() + 300_000 }));
            const { message } = JSON.parse(String(init?.body));
            const parsed = parseSiweMessage(message);
            return new Response(JSON.stringify({ token: `tok-${parsed.nonce}`, address: parsed.address, expiresAt: Date.now() + 3_600_000 }));
        });
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('builds an EIP-4361 message for this site and chain, and stores the token per address', async () => {
        const sign = vi.fn((message: string) => wallet.signMessage({ message }));
        const changed = vi.fn();
        const off = subscribeSessions(changed);
        const s = await signInWithEthereum(A, 31337, sign);
        off();
        const parsed = parseSiweMessage(sign.mock.calls[0][0]);
        expect(parsed).toMatchObject({ domain: 'localhost:8080', address: A, chainId: 31337, nonce: 'abcdefgh12345678', uri: 'http://localhost:8080', version: '1' });
        expect(parsed.statement).toMatch(/costs no gas/);
        expect(s.token).toBe('tok-abcdefgh12345678');
        expect(getSession(A.toLowerCase())?.token).toBe(s.token);
        expect(getSession('0x0000000000000000000000000000000000000001')).toBeNull();
        expect(changed).toHaveBeenCalled();
        const body = JSON.parse(String(fetchMock.mock.calls[1][1].body));
        expect(body.signature).toMatch(/^0x[0-9a-f]{130}$/);
    });

    it('asks the wallet once: concurrent callers share the sign-in, later callers reuse the token', async () => {
        const sign = vi.fn((message: string) => wallet.signMessage({ message }));
        const [a, b] = await Promise.all([ensureSession(A, 31337, sign), ensureSession(A, 31337, sign)]);
        expect(a.token).toBe(b.token);
        await ensureSession(A, 31337, sign);
        expect(sign).toHaveBeenCalledTimes(1);
        await ensureSession(A, 31337, sign, { force: true });
        expect(sign).toHaveBeenCalledTimes(2);
    });

    it('treats a token about to expire as gone, and forgets it on clear', () => {
        saveSession({ token: 't', address: A, expiresAt: Date.now() + 30_000 });
        expect(getSession(A)).toBeNull(); // inside the 60 s margin
        saveSession({ token: 't', address: A, expiresAt: Date.now() + 600_000 });
        expect(getSession(A)?.token).toBe('t');
        clearSession(A);
        expect(getSession(A)).toBeNull();
    });

    it('surfaces the server refusal', async () => {
        fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'too many requests from this IP: retry in 5 s' }), { status: 429 }));
        await expect(signInWithEthereum(A, 31337, vi.fn())).rejects.toThrow(/too many requests/);
    });
});
