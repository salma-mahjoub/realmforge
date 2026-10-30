import { useAccount, useChainId, useReadContract } from 'wagmi';
import { forgeCoinAbi } from '../generated';
import { contractsConfigured, getAddresses } from '../addresses';
import { useTx } from './useTx';

/** `ForgeCoin.claimFaucet()` — 100 FORGE once per address (SPEC §5.1). */
export function useFaucet() {
    const { address } = useAccount();
    const chainId = useChainId();
    const { forgeCoin } = getAddresses(chainId);
    const tx = useTx();

    // NOTE: getter name assumed (`faucetClaimed(address)`); align with the generated ABI.
    const claimed = useReadContract({
        address: forgeCoin,
        abi: forgeCoinAbi,
        functionName: 'faucetClaimed',
        args: address ? [address] : undefined,
        query: { enabled: contractsConfigured && Boolean(address) },
    });

    const claim = () =>
        tx.write.writeContractAsync({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'claimFaucet', args: [] });

    return { claim, claimed: claimed.data, canClaim: contractsConfigured && Boolean(address) && claimed.data === false, ...tx };
}
