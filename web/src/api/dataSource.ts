import { useSyncExternalStore } from 'react';

/**
 * Tracks which API reads fell back to bundled sample data (src/data/mock.ts), so pages can label
 * sample numbers honestly instead of presenting them as live indexer data.
 */
const mocked = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const norm = (path: string) => path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');

export function markMock(path: string) {
    const key = norm(path);
    if (mocked.has(key)) return;
    mocked.add(key);
    version++;
    listeners.forEach((l) => l());
}

export function markLive(path: string) {
    if (!mocked.delete(norm(path))) return;
    version++;
    listeners.forEach((l) => l());
}

export const isMocked = (path?: string) => (path ? mocked.has(norm(path)) : mocked.size > 0);

const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
};

/** True when any (or the given) endpoint is currently served from sample data. */
export function useMockData(path?: string): boolean {
    useSyncExternalStore(subscribe, () => version, () => version);
    return isMocked(path);
}
