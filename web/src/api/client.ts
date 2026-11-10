import { formatEther, formatUnits, getAddress, isAddress, type Address, type Hex } from 'viem';
import { MOCK_EARNINGS, MOCK_LEADERBOARD, MOCK_LEVELS, MOCK_LISTINGS, MOCK_RECENT_TX, mockProfile } from '../data/mock';
import { SAMPLE_LEVEL } from '../game/level';
import { markLive, markMock } from './dataSource';
import { emptyLineage, mapLineage, type RemixLineage, type RemixLineageResponse } from './remix';
import type { LevelFileV1, Theme } from '../game/level/types';
import { THEMES } from '../game/level/types';
import { timeAgo } from '../components/ui/format';
import type {
    ClearProofRequest,
    ClearProofResponse,
    LeaderboardEntry,
    LevelDetail,
    LevelRow,
    LevelSort,
    LevelSummary,
    Listing,
    PinRequest,
    PinResponse,
    ProfileSummary,
    SeasonRankingResponse,
    SeasonStandingsResponse,
    RecentTx,
    RunRejected,
    SubmitRunRequest,
    SubmitRunResponse,
} from './types';

/** server/ Fastify API (default port 8787, see server/.env.example). */
export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');
/** Local dev: the server's own gateway serves files stored by its local pinner. */
export const IPFS_GATEWAY = import.meta.env.VITE_IPFS_GATEWAY || `${API_URL}/ipfs/`;
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
    if (!res.ok) {
        const b = body as (RunRejected & { message?: string }) | undefined;
        const issues = b?.issues?.length ? `: ${b.issues.map((i) => i.message).join('; ')}` : '';
        throw new ApiError(res.status, `${b?.error ?? b?.message ?? res.statusText}${issues}`, body);
    }
    return body as T;
}

/** Read endpoints fall back to mock data in dev when the API is down. Writes never do. */
async function read<T>(path: string, mock: () => T, map?: (raw: never) => T): Promise<T> {
    try {
        const raw = await request<unknown>(path);
        const out = map ? map(raw as never) : (raw as T);
        markLive(path);
        return out;
    } catch (err) {
        if (!USE_MOCKS) throw err;
        console.info(`[api] ${path} unavailable, using mock data`);
        markMock(path);
        return mock();
    }
}

const addr = (a: string | null | undefined): Address => (a && isAddress(a) ? getAddress(a) : ('0x0000000000000000000000000000000000000000' as Address));

export function rowToSummary(r: LevelRow): LevelSummary {
    return {
        id: r.id,
        name: r.name ?? `Level #${r.id}`,
        theme: (THEMES as readonly string[]).includes(r.theme ?? '') ? (r.theme as Theme) : 'grass',
        creator: addr(r.creator),
        playFee: formatUnits(BigInt(r.play_fee ?? '0'), 18),
        plays: r.plays,
        clearRate: r.plays ? r.clears / r.plays : 0,
        likes: r.likes,
        bestTimeMs: r.best_time_ms,
        createdAt: new Date(r.created_at).toISOString(),
        listedPriceEth: r.listing_price && r.listing_price !== '0' ? formatEther(BigInt(r.listing_price)) : null,
        cid: r.level_cid ?? '',
        thumbnailUrl: r.thumbnail_cid ? `${IPFS_GATEWAY}${r.thumbnail_cid}` : undefined,
    };
}

export function rowToDetail(r: LevelRow): LevelDetail {
    return {
        ...rowToSummary(r),
        owner: addr(r.owner),
        royaltyBps: 500,
        layoutHash: r.layout_hash as Hex,
        parentId: r.parent_id,
        clears: r.clears,
        creatorEarned: r.earned ? formatUnits(BigInt(r.earned), 18) : '0',
    };
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
    health: () => request<{ status: string; chainId: number; signer: Address; contracts: { levelNFT: Address | null; forgeCoin: Address | null; realmBadges: Address | null } }>('/health'),

    // levels / indexer — GET /levels returns { items: LevelRow[] }
    listLevels: (q: { sort?: LevelSort; creator?: string; theme?: string; search?: string } = {}) => {
        const params = new URLSearchParams();
        if (q.sort) params.set('sort', q.sort);
        if (q.creator && isAddress(q.creator)) params.set('creator', q.creator);
        const qs = params.toString();
        const filter = (out: LevelSummary[]) => {
            if (q.theme && q.theme !== 'all') out = out.filter((l) => l.theme === q.theme);
            if (q.search) out = out.filter((l) => l.name.toLowerCase().includes(q.search!.toLowerCase()));
            return out;
        };
        return read<LevelSummary[]>(
            `/levels${qs ? `?${qs}` : ''}`,
            () => {
                const out = filter([...MOCK_LEVELS]);
                if (q.sort === 'popular') out.sort((a, b) => b.plays - a.plays);
                if (q.sort === 'hardest') out.sort((a, b) => a.clearRate - b.clearRate);
                return out;
            },
            (raw: { items: LevelRow[] }) => filter(raw.items.map(rowToSummary)),
        );
    },
    getLevel: (id: number) =>
        read<LevelDetail>(`/levels/${id}`, () => detailFromSummary(MOCK_LEVELS.find((l) => l.id === id) ?? { ...MOCK_LEVELS[1], id }), rowToDetail),
    /** Pinned level.v1 JSON of an on-chain level (server: GET /levels/:id/file). */
    getLevelFile: (id: number) => read<LevelFileV1>(`/levels/${id}/file`, () => SAMPLE_LEVEL),
    /** Same file, but never falls back to the bundled sample: a remix must copy the real parent. */
    getLevelFileLive: (id: number) => request<LevelFileV1>(`/levels/${id}/file`),
    /** Remix lineage: ancestors chain + direct remixes (server: GET /levels/:id/remixes, indexed parentId). */
    getRemixes: (id: number) => read<RemixLineage>(`/levels/${id}/remixes`, () => emptyLineage(id), (raw: RemixLineageResponse) => mapLineage(raw)),
    getLeaderboard: (id: number, top = 5) =>
        read<LeaderboardEntry[]>(`/levels/${id}/leaderboard?limit=${top}`, () => MOCK_LEADERBOARD.slice(0, top), (raw: { entries: { rank: number; player: string; timeMs: number }[] }) =>
            raw.entries.map((e) => ({ rank: e.rank, player: addr(e.player), timeMs: e.timeMs })),
        ),
    getReplays: (id: number) =>
        read<{ player: Address; timeMs: number; inputLog: string }[]>(`/levels/${id}/replays`, () => [], (raw: { replays: { player: string; timeMs: number; inputLog: string }[] }) =>
            raw.replays.map((r) => ({ ...r, player: addr(r.player) })),
        ),

    // Indexed from the chain by server/ (GET /levels/:id/activity, /levels/:id/earnings, /profiles/:address, /market/listings).
    getLevelActivity: (id: number) =>
        read<RecentTx[]>(`/levels/${id}/activity`, () => (USE_MOCKS ? MOCK_RECENT_TX : []), (raw: { items: { kind: string; hash: string; at: number }[] }) =>
            raw.items.map((i) => ({ kind: i.kind as RecentTx['kind'], hash: i.hash, status: 'Confirmed' as const, ago: timeAgo(i.at) })),
        ),
    getCreatorEarnings: (id: number) =>
        read<{ day: string; forge: number }[]>(`/levels/${id}/earnings`, () => (USE_MOCKS ? MOCK_EARNINGS : []), (raw: { days: { day: string; forge: number }[] }) => raw.days),
    getProfile: (address: Address) =>
        read<ProfileSummary>(
            `/profiles/${address}`,
            () => mockProfile(address),
            (raw: { plays: number; clears: number; bestRank: number | null; created: LevelRow[]; owned: LevelRow[]; recentClears: { level: LevelRow; timeMs: number; reward: string; at: number | null }[] }) => ({
                address,
                forgeBalance: '0', // the page reads the live balance from the chain
                plays: raw.plays,
                clears: raw.clears,
                bestRank: raw.bestRank,
                created: raw.created.map(rowToSummary),
                owned: raw.owned.map(rowToSummary),
                recentClears: raw.recentClears.map((r) => ({ level: rowToSummary(r.level), timeMs: r.timeMs, reward: formatUnits(BigInt(r.reward || '0'), 18), ago: r.at ? timeAgo(r.at) : '' })),
            }),
        ),
    getBadges: (address: Address) => request<{ address: Address; earned: { badgeId: number; ref: string; hash: string; name: string }[]; claimable: { badgeId: number; ref: string; name: string; description: string }[] }>(`/profiles/${address}/badges`),
    getBadgeClaimProof: (holder: Address, badgeId: number, ref: string) => request<{ message: { holder: Address; badgeId: string; ref: string; nonce: string; deadline: string }; signature: `0x${string}` }>(`/badges/claim-proof`, { method: 'POST', json: { holder, badgeId, ref } }),
    listListings: () =>
        read<Listing[]>('/market/listings', () => (USE_MOCKS ? MOCK_LISTINGS : []), (raw: { items: LevelRow[] }) =>
            raw.items.map((r) => ({
                level: rowToSummary(r),
                seller: addr(r.owner),
                priceEth: formatEther(BigInt(r.listing_price ?? '0')),
                royaltyBps: 500,
                listedAgo: r.listed_at ? timeAgo(r.listed_at) : '',
            })),
        ),

    // seasons (docs/SEASONS.md): live ranking, and the server-signed ranking the admin submits to closeSeason
    getSeason: () => request<SeasonRankingResponse>('/season/current'),
    getSeasonStandings: () => request<SeasonStandingsResponse>('/season/standings'),
    requestSeasonProof: () => request<unknown>('/season/close-proof', { method: 'POST' }),

    // publish flow (SPEC §3.3): pin first, then the clear proof references the pinned layoutHash
    pinLevel: (body: PinRequest) => request<PinResponse>('/levels/pin', { method: 'POST', json: body }),
    requestClearProof: (body: ClearProofRequest) => request<ClearProofResponse>('/levels/clear-proof', { method: 'POST', json: body }),

    // runs (SPEC §3.6 / §5.2)
    submitRun: (body: SubmitRunRequest) => request<SubmitRunResponse>('/runs/validate', { method: 'POST', json: body }),
};

export function ipfsToHttp(uri: string): string {
    return uri.startsWith('ipfs://') ? `${IPFS_GATEWAY}${uri.slice('ipfs://'.length)}` : uri;
}
