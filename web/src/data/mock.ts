/**
 * Placeholder data shaped like the UI mockups (docs/mockups/*.png). Used when the API is not
 * reachable and VITE_USE_MOCKS=true. Shapes match src/api/types.ts.
 */
import type { Address } from 'viem';
import type { LeaderboardEntry, LevelSummary, Listing, ProfileSummary, RecentTx, RoomPlayer } from '../api/types';

const A = (s: string) => s as Address;

export const MOCK_ME = A('0x7a3c5e2b9d14f08a6e1c3b7d5f9a2e4c6b8d91c4');

export const MOCK_LEVELS: LevelSummary[] = [
    { id: 41, name: 'Seesaw Hell', theme: 'snow', creator: A('0x4b2d9e7c1a3f5b8e0d2c4a6f8b1e3d5c7a9f8e10'), playFee: '5', plays: 1200, clearRate: 0.12, likes: 148, bestTimeMs: 61230, createdAt: '2026-10-29T18:00:00Z', listedPriceEth: null, cid: 'bafybeigdyrseesawhell' },
    { id: 42, name: 'Frozen Pendulums', theme: 'snow', creator: A('0x91f3b6a0c2e4d8f1a3b5c7e9d0f2a4b6c8e2a7c'), playFee: '3', plays: 842, clearRate: 0.24, likes: 96, bestTimeMs: 58120, createdAt: '2026-10-28T12:00:00Z', listedPriceEth: '0.05', cid: 'bafybeifrozenpendulums' },
    { id: 43, name: 'Lava Conveyor', theme: 'castle', creator: A('0x6c8e1a3b5d7f9c2e4a6b8d0f1c3e5a7b9d43d1'), playFee: '8', plays: 2400, clearRate: 0.08, likes: 312, bestTimeMs: 92400, createdAt: '2026-10-27T09:30:00Z', listedPriceEth: '0.12', cid: 'bafybeilavaconveyor' },
    { id: 44, name: 'Cloud Hop', theme: 'grass', creator: A('0x2a5f7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b90b903'), playFee: '2', plays: 615, clearRate: 0.68, likes: 84, bestTimeMs: 34560, createdAt: '2026-10-26T16:45:00Z', listedPriceEth: null, cid: 'bafybeicloudhop' },
    { id: 45, name: 'Desert Dash', theme: 'desert', creator: A('0x8d3b5f7a9c1e3d5b7f9a1c3e5d7b9f1a3c51f62'), playFee: '4', plays: 976, clearRate: 0.35, likes: 127, bestTimeMs: 47810, createdAt: '2026-10-25T11:20:00Z', listedPriceEth: '0.03', cid: 'bafybeidesertdash' },
    { id: 46, name: 'Chain Reaction', theme: 'grass', creator: A('0x3e7a9c1b3d5f7e9a1c3b5d7f9e1a3c5b7d9ac54'), playFee: '6', plays: 1500, clearRate: 0.19, likes: 203, bestTimeMs: 73050, createdAt: '2026-10-24T20:10:00Z', listedPriceEth: null, cid: 'bafybeichainreaction' },
    { id: 47, name: 'Spring Summit', theme: 'snow', creator: A('0x5f1c3e5a7b9d1f3a5c7e9b1d3f5a7c9e1b372b8'), playFee: '3', plays: 723, clearRate: 0.42, likes: 109, bestTimeMs: 52990, createdAt: '2026-10-23T08:05:00Z', listedPriceEth: '0.04', cid: 'bafybeispringsummit' },
    { id: 48, name: 'Coin Canyon', theme: 'desert', creator: A('0x7a9e2c4b6d8f0a2c4e6b8d0f2a4c6e8b0d2e216'), playFee: '2', plays: 534, clearRate: 0.76, likes: 72, bestTimeMs: 29870, createdAt: '2026-10-22T14:40:00Z', listedPriceEth: null, cid: 'bafybeicoincanyon' },
];

export const MOCK_LEADERBOARD: LeaderboardEntry[] = [
    { rank: 1, player: A('0x2f8c4a6e8b0d2f4a6c8e0b2d4f6a8c0e2b4da902'), timeMs: 58120, txHash: '0xa83f6c2e9b1d4f7a0c3e5b8d1f4a7c0e3b6d91d2' },
    { rank: 2, player: A('0x6b1e3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3bc437'), timeMs: 62450 },
    { rank: 3, player: A('0x4d9a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1de821'), timeMs: 65900 },
    { rank: 4, player: A('0x8a3c5e7b9d1f3a5c7e9b1d3f5a7c9e1b3d571f6'), timeMs: 68330 },
    { rank: 5, player: A('0x1c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9d054'), timeMs: 72760 },
];

export const MOCK_EARNINGS: { day: string; forge: number }[] = [
    { day: 'Mon', forge: 80 },
    { day: 'Tue', forge: 240 },
    { day: 'Wed', forge: 480 },
    { day: 'Thu', forge: 690 },
    { day: 'Fri', forge: 620 },
    { day: 'Sat', forge: 910 },
    { day: 'Sun', forge: 1180 },
];

export const MOCK_RECENT_TX: RecentTx[] = [
    { kind: 'Play fee', hash: '0xa83f6c2e9b1d4f7a0c3e5b8d1f4a7c0e3b6d91d2', status: 'Confirmed', ago: '12h ago' },
    { kind: 'New record', hash: '0x7bc2e4a6c8e0b2d4f6a8c0e2b4d6f8a0c2e44e08', status: 'Confirmed', ago: '1d ago' },
    { kind: 'Listed', hash: '0xf219b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3a6c3', status: 'Confirmed', ago: '2d ago' },
];

export const MOCK_LISTINGS: Listing[] = MOCK_LEVELS.filter((l) => l.listedPriceEth).map((l) => ({
    level: l,
    seller: l.creator,
    priceEth: l.listedPriceEth!,
    royaltyBps: 500,
    listedAgo: `${(l.id % 5) + 1}d ago`,
}));

export const MOCK_ROOM_PLAYERS: RoomPlayer[] = [
    { sessionId: 'p1', address: MOCK_ME, color: 0x7c5cff, stakePaid: true, ready: true, isYou: true },
    { sessionId: 'p2', address: A('0x2f8c4a6e8b0d2f4a6c8e0b2d4f6a8c0e2b4da620'), color: 0x22d3ee, stakePaid: true, ready: true },
    { sessionId: 'p3', address: A('0x9d1e3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b4b73'), color: 0xf43f5e, stakePaid: true, ready: false },
    { sessionId: 'p4', address: A('0x6c5a1c3e5b7d9f1a3c5e7b9d1f3a5c7e9b1de812'), color: 0xffc83d, stakePaid: true, ready: true },
];

export function mockProfile(address: Address): ProfileSummary {
    return {
        address,
        forgeBalance: '1240',
        clears: 37,
        plays: 112,
        bestRank: 1,
        created: MOCK_LEVELS.slice(0, 3),
        owned: MOCK_LEVELS.slice(2, 5),
        recentClears: MOCK_LEVELS.slice(3, 7).map((l, i) => ({ level: l, timeMs: (l.bestTimeMs ?? 60000) + 1000 * (i + 1), reward: `${12 - i * 2}`, ago: `${i + 1}d ago` })),
    };
}
