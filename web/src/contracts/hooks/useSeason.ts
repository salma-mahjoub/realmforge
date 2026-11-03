import type { Address, Hex } from 'viem';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import { forgeCoinAbi } from '../generated';
import { contractsConfigured, getAddresses } from '../addresses';
import { useTx } from './useTx';

/** A `SeasonResult` signed by the game server (`POST /season/close-proof`), ready for `closeSeason`. */
export interface SignedSeason {
    players: Address[];
    creators: Address[];
    /** basis points, players first then creators, summing to 10 000 */
    shares: bigint[];
    signature: Hex;
}

/** Parses the server's close-proof response (bigint fields arrive as strings). */
export function parseSeasonProof(raw: unknown): SignedSeason | null {
    const m = raw as { message?: { players?: Address[]; creators?: Address[]; shares?: (string | number)[] }; signature?: Hex } | null;
    if (!m?.message?.players || !m.message.creators || !m.message.shares || !m.signature) return null;
    return { players: m.message.players, creators: m.message.creators, shares: m.message.shares.map((s) => BigInt(s)), signature: m.signature };
}

/** The prize a winner receives from a pool: `pool * share / 10 000`, like `ForgeCoin.closeSeason`. */
export const prizeOf = (pool: bigint, shareBps: number | bigint) => (pool * BigInt(shareBps)) / 10_000n;

/**
 * ForgeCoin seasons (SPEC §5.3): the live season number, end time and prize pool, whether the connected wallet is
 * the contract admin, and `closeSeason` (admin only, after `seasonEnd`, with the server's signed ranking).
 */
export function useSeason() {
    const { address } = useAccount();
    const chainId = useChainId();
    const { forgeCoin } = getAddresses(chainId);
    const tx = useTx();
    const enabled = contractsConfigured;
    const common = { address: forgeCoin, abi: forgeCoinAbi } as const;
    const q = { enabled, refetchInterval: 15_000 };

    const season = useReadContract({ ...common, functionName: 'season', query: q });
    const seasonEnd = useReadContract({ ...common, functionName: 'seasonEnd', query: q });
    const seasonPool = useReadContract({ ...common, functionName: 'seasonPool', query: q });
    const adminRole = useReadContract({ ...common, functionName: 'DEFAULT_ADMIN_ROLE', query: { enabled } });
    const isAdminQ = useReadContract({
        ...common,
        functionName: 'hasRole',
        args: adminRole.data && address ? [adminRole.data, address] : undefined,
        query: { enabled: enabled && Boolean(adminRole.data) && Boolean(address) },
    });

    const close = (s: SignedSeason) =>
        tx.write.writeContractAsync({ ...common, functionName: 'closeSeason', args: [s.players, s.creators, s.shares, s.signature] });

    return {
        season: season.data,
        seasonEnd: seasonEnd.data !== undefined ? Number(seasonEnd.data) : undefined,
        pool: seasonPool.data,
        isAdmin: isAdminQ.data === true,
        close,
        refetch: () => Promise.all([season.refetch(), seasonEnd.refetch(), seasonPool.refetch()]),
        ...tx,
    };
}
