import type { Address } from 'viem';
import { MOCK_EARNINGS, MOCK_LEADERBOARD, MOCK_LEVELS, MOCK_LISTINGS, MOCK_RECENT_TX, mockProfile } from '../data/mock';
import { SAMPLE_LEVEL } from '../game/level';
import type { LevelFileV1 } from '../game/level/types';
import type {
    ClearProofRequest,
    ClearProofResponse,
    LeaderboardEntry,
    LevelDetail,
    LevelSort,
    LevelSummary,
    Listing,
    PinRequest,
    PinResponse,
    ProfileSummary,
    RecentTx,
    SubmitRunRequest,
    SubmitRunResponse,
} from './types';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
export const IPFS_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';
const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS ?? 'true') !== 'false';

export class ApiError extends Error {
    constructor(readonly status: number, message: string, readonly body?: unknown) {
        super(message);
    }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
    const { json, ...rest } = init ?? {};
    const res = await fetch(`${API_URL}${path}`, {
        ...rest,
        headers: { Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    const text = await res.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiError(res.status, (body as { message?: string })?.message ?? res.statusText, body);
    return body as T;
}

/** Read endpoints fall back to mock data in dev when the API is down. Writes never do. */
async function read<T>(path: string, mock: () => T): Promise<T> {
    try {
        return await request<T>(path);
    } catch (err) {
        if (!USE_MOCKS) throw err;
        console.info(`[api] ${path} unavailable, using mock data`);
        return mock();
    }
}

const detailFromSummary = (l: LevelSummary): LevelDetail => ({
    ...l,
    owner: l.creator,
    royaltyBps: 500,
    layoutHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    parentId: 0,
    clears: Math.round(l.plays * l.clearRate),
    creatorEarned: '4520',
});

export const api = {
    health: () => request<{ ok: boolean }>('/health'),

    // levels / indexer
    listLevels: (q: { sort?: LevelSort; creator?: string; theme?: string; search?: string } = {}) => {
        const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
        return read<LevelSummary[]>(`/levels${qs ? `?${qs}` : ''}`, () => {
            let out = [...MOCK_LEVELS];
            if (q.theme && q.theme !== 'all') out = out.filter((l) => l.theme === q.theme);
            if (q.search) out = out.filter((l) => l.name.toLowerCase().includes(q.search!.toLowerCase()));
            if (q.sort === 'popular') out.sort((a, b) => b.plays - a.plays);
            if (q.sort === 'hardest') out.sort((a, b) => a.clearRate - b.clearRate);
            return out;
        });
    },
    getLevel: (id: number) =>
        read<LevelDetail>(`/levels/${id}`, () => detailFromSummary(MOCK_LEVELS.find((l) => l.id === id) ?? { ...MOCK_LEVELS[1], id })),
    getLevelFile: (id: number) => read<LevelFileV1>(`/levels/${id}/file`, () => SAMPLE_LEVEL),
    getLeaderboard: (id: number, top = 5) => read<LeaderboardEntry[]>(`/levels/${id}/leaderboard?top=${top}`, () => MOCK_LEADERBOARD.slice(0, top)),
    getLevelActivity: (id: number) => read<RecentTx[]>(`/levels/${id}/activity`, () => MOCK_RECENT_TX),
    getCreatorEarnings: (id: number) => read<{ day: string; forge: number }[]>(`/levels/${id}/earnings?days=7`, () => MOCK_EARNINGS),
    getReplays: (id: number, top = 3) => read<{ player: Address; timeMs: number; inputs: Array<[number, number]> }[]>(`/levels/${id}/replays?top=${top}`, () => []),

    // profiles / market
    getProfile: (address: Address) => read<ProfileSummary>(`/profiles/${address}`, () => mockProfile(address)),
    listListings: () => read<Listing[]>('/market/listings', () => MOCK_LISTINGS),

    // publish flow (SPEC §3.3)
    requestClearProof: (body: ClearProofRequest) => request<ClearProofResponse>('/levels/clear-proof', { method: 'POST', json: body }),
    pinLevel: (body: PinRequest) => request<PinResponse>('/ipfs/pin', { method: 'POST', json: body }),

    // runs (SPEC §3.6 / §5.2)
    submitRun: (body: SubmitRunRequest) => request<SubmitRunResponse>('/runs', { method: 'POST', json: body }),
};

export function ipfsToHttp(uri: string): string {
    return uri.startsWith('ipfs://') ? `${IPFS_GATEWAY}${uri.slice('ipfs://'.length)}` : uri;
}
