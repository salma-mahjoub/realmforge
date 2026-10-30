import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import type { TxPhase } from './types';

/** Shared write + receipt tracking used by the write hooks. */
export function useTx() {
    const write = useWriteContract();
    const receipt = useWaitForTransactionReceipt({ hash: write.data, query: { enabled: Boolean(write.data) } });
    const phase: TxPhase = write.isPending
        ? 'signing'
        : write.isError || receipt.isError
          ? 'error'
          : receipt.isSuccess
            ? 'confirmed'
            : write.data
              ? 'pending'
              : 'idle';
    return {
        write,
        receipt,
        phase,
        hash: write.data,
        error: write.error ?? receipt.error ?? null,
        reset: write.reset,
    };
}
