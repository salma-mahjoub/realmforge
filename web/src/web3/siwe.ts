import { useCallback, useEffect, useState } from 'react';
import type { Address } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { useAccount, useSignMessage } from 'wagmi';
import { API_URL } from '../api/client';

/**
 * Sign-In With Ethereum (EIP-4361), client side. One free signature (no transaction, no gas) gets a short-lived
 * session token from the server (POST /auth/verify). The token is kept per wallet address in localStorage and sent
 * when joining race / co-op rooms, so the wallet is not asked again until it expires.
 */
export interface SiweSession {
    token: string;
    address: Address;
    /** ms since epoch */
    expiresAt: number;
}

export const SIWE_STATEMENT =
    'Sign in to RealmForge. This free signature proves that you own this wallet so you can join race and co-op rooms. It is not a transaction and costs no gas.';

/** A token this close to expiry is treated as expired (a race can take minutes after the join). */
const EXPIRY_MARGIN_MS = 60_000;
const storageKey = (address: string) => `rf:siwe:${address.toLowerCase()}`;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getSession(address: string | undefined, now = Date.now()): SiweSession | null {
    if (!address) return null;
    try {
        const raw = localStorage.getItem(storageKey(address));
        if (!raw) return null;
        const s = JSON.parse(raw) as SiweSession;
        if (typeof s.token !== 'string' || s.address?.toLowerCase() !== address.toLowerCase() || !(s.expiresAt - EXPIRY_MARGIN_MS > now)) return null;
        return s;
    } catch {
        return null;
    }
}

export function saveSession(s: SiweSession) {
    try {
        localStorage.setItem(storageKey(s.address), JSON.stringify(s));
    } catch {
        /* storage disabled: the session lives until the page closes via the in-flight cache only */
    }
    notify();
}

export function clearSession(address: string) {
    try {
        localStorage.removeItem(storageKey(address));
    } catch {
        /* storage disabled */
    }
    notify();
}

export function subscribeSessions(cb: () => void) {
    listeners.add(cb);
    return () => void listeners.delete(cb);
}

export type SignFn = (message: string) => Promise<string>;

async function requestJson<T>(path: string, json?: unknown): Promise<T> {
    const res = await fetch(`${API_URL}${path}`, {
        method: json === undefined ? 'GET' : 'POST',
        headers: { Accept: 'application/json', ...(json === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: json === undefined ? undefined : JSON.stringify(json),
    });
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `sign-in failed (HTTP ${res.status})`);
    return body;
}

/** Nonce -> EIP-4361 message -> wallet signature -> session token. Always asks the wallet. */
export async function signInWithEthereum(address: Address, chainId: number, sign: SignFn): Promise<SiweSession> {
    const { nonce } = await requestJson<{ nonce: string }>('/auth/nonce');
    const now = new Date();
    const message = createSiweMessage({
        domain: window.location.host,
        address,
        statement: SIWE_STATEMENT,
        uri: window.location.origin,
        version: '1',
        chainId,
        nonce,
        issuedAt: now,
        expirationTime: new Date(now.getTime() + 10 * 60_000),
    });
    const signature = await sign(message);
    const s = await requestJson<SiweSession>('/auth/verify', { message, signature });
    const session = { token: s.token, address: s.address, expiresAt: s.expiresAt };
    saveSession(session);
    return session;
}

const inflight = new Map<string, Promise<SiweSession>>();
/** Stored session if still valid, else one sign-in; concurrent callers (StrictMode, several joins) share it. */
export function ensureSession(address: Address, chainId: number, sign: SignFn, opts: { force?: boolean } = {}): Promise<SiweSession> {
    if (!opts.force) {
        const s = getSession(address);
        if (s) return Promise.resolve(s);
    }
    const key = address.toLowerCase();
    let p = inflight.get(key);
    if (!p) {
        p = signInWithEthereum(address, chainId, sign).finally(() => inflight.delete(key));
        inflight.set(key, p);
    }
    return p;
}

/** Gives rooms a token, and a fresh one if the server refused the stored token (expired, server restarted). */
export interface SessionProvider {
    token(): Promise<string>;
    renew(): Promise<string>;
}

export function useSiwe() {
    const { address, chainId } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const [session, setSession] = useState(() => getSession(address));
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        setSession(getSession(address));
        return subscribeSessions(() => setSession(getSession(address)));
    }, [address]);

    const sign = useCallback<SignFn>((message) => signMessageAsync({ message }), [signMessageAsync]);
    const run = useCallback(
        async (force: boolean) => {
            if (!address || !chainId) throw new Error('Connect a wallet first.');
            setBusy(true);
            try {
                return await ensureSession(address, chainId, sign, { force });
            } finally {
                setBusy(false);
            }
        },
        [address, chainId, sign],
    );
    const provider: SessionProvider = {
        token: async () => (await run(false)).token,
        renew: async () => {
            if (address) clearSession(address);
            return (await run(true)).token;
        },
    };
    return { address, session, signedIn: session !== null, busy, signIn: () => run(false), provider };
}
