import { isAddressEqual, parseEventLogs, type Address, type Hex, type TransactionReceipt } from 'viem';
import { useAccount, useBlock, useChainId, useReadContract } from 'wagmi';
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

/** One FORGE transfer made by `closeSeason`, labelled with the side of the signed arrays it came from. */
export interface SeasonPayout {
    kind: 'player' | 'creator';
    /** 1-based rank inside its side */
    rank: number;
    address: Address;
    amount: bigint;
    shareBps: bigint;
}

/**
 * What `closeSeason` actually paid, read from the transaction receipt: the ERC-20 `Transfer`s out of ForgeCoin's own
 * balance, in order (players first, then creators, exactly like the signed arrays).
 */
export function payoutsFromReceipt(receipt: Pick<TransactionReceipt, 'logs'>, forgeCoin: Address, proof: SignedSeason): SeasonPayout[] {
    const transfers = parseEventLogs({ abi: forgeCoinAbi, eventName: 'Transfer', logs: receipt.logs }).filter(
        (l) => isAddressEqual(l.address, forgeCoin) && isAddressEqual(l.args.from, forgeCoin),
    );
    const np = proof.players.length;
    return transfers.map((l, i) => ({
        kind: i < np ? 'player' : 'creator',
        rank: i < np ? i + 1 : i - np + 1,
        address: l.args.to,
        amount: l.args.value,
        shareBps: proof.shares[i] ?? 0n,
    }));
}

/** "12d 4h 03m 09s" style countdown (always shows seconds, so the demo visibly ticks); "ended" at or below 0. */
export function formatCountdown(sec: number): string {
    if (sec <= 0) return 'ended';
    const s = Math.floor(sec);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return d > 0 ? `${d}d ${h}h ${pad(m)}m ${pad(s % 60)}s` : h > 0 ? `${h}h ${pad(m)}m ${pad(s % 60)}s` : `${m}m ${pad(s % 60)}s`;
}

/**
 * Seconds left in the season by the *chain* clock: the contract compares `seasonEnd` with `block.timestamp`, which
 * on a local chain can be far from the wall clock after `npm run season:ff`. `chainTs` is the latest block's
 * timestamp, observed at `observedAt` (ms); the wall time elapsed since is added so the countdown keeps ticking.
 */
export function secondsLeft(seasonEnd: number, chainTs: number | undefined, observedAt: number, nowMs: number): number {
    const chainNow = chainTs !== undefined ? chainTs + Math.max(0, (nowMs - observedAt) / 1000) : nowMs / 1000;
    return seasonEnd - chainNow;
}

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

    // the latest block's timestamp drives the countdown (see secondsLeft)
    const block = useBlock({ query: { enabled, refetchInterval: 10_000 } });

    const close = (s: SignedSeason) =>
        tx.write.writeContractAsync({ ...common, functionName: 'closeSeason', args: [s.players, s.creators, s.shares, s.signature] });

    return {
        season: season.data,
        seasonEnd: seasonEnd.data !== undefined ? Number(seasonEnd.data) : undefined,
        pool: seasonPool.data,
        isAdmin: isAdminQ.data === true,
        forgeCoin,
        chainTs: block.data ? Number(block.data.timestamp) : undefined,
        chainTsObservedAt: block.dataUpdatedAt,
        close,
        refetch: () => Promise.all([season.refetch(), seasonEnd.refetch(), seasonPool.refetch(), block.refetch()]),
        ...tx,
    };
}
