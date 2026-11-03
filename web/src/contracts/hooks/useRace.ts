import { keccak256, toHex, type Address, type Hex } from 'viem';
import { useChainId, useReadContract } from 'wagmi';
import { forgeCoinAbi } from '../generated';
import { contractsConfigured, getAddresses } from '../addresses';
import { useTx } from './useTx';

/** `ForgeCoin.RaceStatus` (None, Open, Settled, Refunded). */
export const RACE_STATUS = { none: 0, open: 1, settled: 2, refunded: 3 } as const;
/** `ForgeCoin.RACE_TIMEOUT`: an unsettled race can be refunded one hour after it was created. */
export const RACE_TIMEOUT_SEC = 3600;

/**
 * On-chain race id for a Colyseus room code. Same rule as the server (BaseMatchRoom: `keccak256(toHex(roomId))`
 * when no `raceId` option is given), so the room, the escrow and the signed `RaceResult` all share one id.
 */
export const raceIdFor = (roomCode: string): Hex => keccak256(toHex(roomCode));

/** The server's signed `RaceResult` (EIP-712) as broadcast by the `result` message of a race room. */
export interface SignedRaceResult {
    roomId: Hex;
    /** ranking[0] = 1st, ranking[1] = 2nd; only these two are paid. */
    ranking: Address[];
    deadline: bigint;
    signature: Hex;
}

/** Parses the room's `result` broadcast (bigint fields arrive as strings) into a settle-ready object. */
export function parseRaceResult(message: unknown): SignedRaceResult | null {
    const m = message as { result?: { roomId?: string; ranking?: string[]; deadline?: string | number }; signature?: string } | null;
    if (!m?.result?.roomId || !Array.isArray(m.result.ranking) || m.result.deadline === undefined || !m.signature) return null;
    return {
        roomId: m.result.roomId as Hex,
        ranking: m.result.ranking as Address[],
        deadline: BigInt(m.result.deadline),
        signature: m.signature as Hex,
    };
}

/**
 * ForgeCoin versus races (SPEC §5.3): escrow `createRaceRoom` / `joinRace`, payout `settleRace(roomId, ranking,
 * deadline, sig)` (anyone can submit the server's signed ranking) and `refundRace` after the timeout.
 * Stakes are moved with `_transfer` by the payer, so no `approve` is needed.
 */
export function useRace(roomCode?: string) {
    const chainId = useChainId();
    const { forgeCoin } = getAddresses(chainId);
    const tx = useTx();
    const raceId = roomCode ? raceIdFor(roomCode) : undefined;

    const race = useReadContract({
        address: forgeCoin,
        abi: forgeCoinAbi,
        functionName: 'getRace',
        args: raceId ? [raceId] : undefined,
        query: { enabled: contractsConfigured && Boolean(raceId), refetchInterval: 5_000 },
    });

    const createRoom = (code: string, levelId: bigint, stake: bigint) =>
        tx.write.writeContractAsync({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'createRaceRoom', args: [raceIdFor(code), levelId, stake] });

    const join = (code: string) => tx.write.writeContractAsync({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'joinRace', args: [raceIdFor(code)] });

    const settle = (r: SignedRaceResult) =>
        tx.write.writeContractAsync({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'settleRace', args: [r.roomId, r.ranking, r.deadline, r.signature] });

    const refund = (code: string) => tx.write.writeContractAsync({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'refundRace', args: [raceIdFor(code)] });

    return { raceId, race: race.data, refetch: race.refetch, createRoom, join, settle, refund, ...tx };
}
