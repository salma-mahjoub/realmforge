import { useChainId } from 'wagmi';
import type { Hex } from 'viem';
import { forgeCoinAbi } from '../generated';
import { getAddresses } from '../addresses';
import { useTx } from './useTx';
import type { RunResult } from './types';

/**
 * `ForgeCoin.settleRun(RunResult, sig)` (SPEC §5.3). The player must have approved the play fee
 * (or use settleRunWithPermit — TODO once the generated ABI is available).
 */
export function useSettleRun() {
    const chainId = useChainId();
    const { forgeCoin } = getAddresses(chainId);
    const tx = useTx();

    const settle = (result: RunResult, sig: Hex) =>
        tx.write.writeContractAsync({
            address: forgeCoin,
            abi: forgeCoinAbi,
            functionName: 'settleRun',
            args: [result, sig],
        });

    return { settle, ...tx };
}
