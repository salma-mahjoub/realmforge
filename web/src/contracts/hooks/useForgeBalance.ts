import { formatUnits, type Address } from 'viem';
import { useAccount, useChainId, useReadContract } from 'wagmi';
import { forgeCoinAbi } from '../generated';
import { contractsConfigured, getAddresses } from '../addresses';

const FORGE_DECIMALS = 18;

/** FORGE (ERC-20) balance of `address` (defaults to the connected account). */
export function useForgeBalance(address?: Address) {
    const account = useAccount();
    const chainId = useChainId();
    const owner = address ?? account.address;
    const { forgeCoin } = getAddresses(chainId);

    const q = useReadContract({
        address: forgeCoin,
        abi: forgeCoinAbi,
        functionName: 'balanceOf',
        args: owner ? [owner] : undefined,
        query: { enabled: contractsConfigured && Boolean(owner), refetchInterval: 12_000 },
    });

    const value = q.data;
    return {
        value,
        formatted: value !== undefined ? formatForge(value) : undefined,
        isLoading: q.isLoading,
        error: q.error,
        refetch: q.refetch,
        enabled: contractsConfigured && Boolean(owner),
    };
}

export function formatForge(v: bigint, maxFrac = 0): string {
    const n = Number(formatUnits(v, FORGE_DECIMALS));
    return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}
