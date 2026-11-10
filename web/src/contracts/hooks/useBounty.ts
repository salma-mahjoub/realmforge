import { useChainId, useWriteContract } from 'wagmi';
import { parseEther, zeroAddress, type Hex } from 'viem';
import { forgeCoinAbi, levelBountyAbi } from '../generated';
import { getAddresses } from '../addresses';

export function useBounty() {
    const chainId = useChainId();
    const { forgeCoin, levelBounty } = getAddresses(chainId);
    const write = useWriteContract();
    const approve = (amount: bigint) => write.writeContractAsync({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'approve', args: [levelBounty, amount] });
    const create = (levelId: bigint, amount: string, targetTimeMs: number, expiry: bigint) => write.writeContractAsync({ address: levelBounty, abi: levelBountyAbi, functionName: 'createBounty', args: [levelId, parseEther(amount), targetTimeMs, expiry] });
    const claim = (claim: { bountyId: bigint; levelId: bigint; player: `0x${string}`; timeMs: number; nonce: bigint; deadline: bigint }, signature: Hex) =>
        write.writeContractAsync({ address: levelBounty, abi: levelBountyAbi, functionName: 'claim', args: [claim, signature] });
    return { approve, create, claim, write, enabled: levelBounty !== zeroAddress };
}
