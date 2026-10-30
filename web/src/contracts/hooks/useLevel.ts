import { useChainId, useReadContracts } from 'wagmi';
import { levelNftAbi } from '../generated';
import { contractsConfigured, getAddresses } from '../addresses';
import type { OnChainLevel } from './types';


/** Read a published level (`levels(id)` + `levelInfo(id)` + `listingPrice(id)` + `tokenURI(id)`). */
export function useLevel(id: bigint | number | undefined) {
    const chainId = useChainId();
    const { levelNFT } = getAddresses(chainId);
    const tokenId = id === undefined ? undefined : BigInt(id);
    const enabled = contractsConfigured && tokenId !== undefined && tokenId > 0n;
    const args = [tokenId ?? 0n] as const;

    const q = useReadContracts({
        allowFailure: true,
        contracts: [
            { address: levelNFT, abi: levelNftAbi, functionName: 'levels', args },
            { address: levelNFT, abi: levelNftAbi, functionName: 'levelInfo', args },
            { address: levelNFT, abi: levelNftAbi, functionName: 'listingPrice', args },
            { address: levelNFT, abi: levelNftAbi, functionName: 'tokenURI', args },
        ],
        query: { enabled },
    });

    let level: OnChainLevel | undefined;
    const [levels, info, listing, uri] = q.data ?? [];
    if (tokenId !== undefined && levels?.status === 'success') {
        const [creator, layoutHash, parentId, playFee, plays, clears, likes, bestTimeMs, bestPlayer, active] = levels.result;
        level = {
            id: tokenId,
            owner: info?.status === 'success' ? info.result[0] : undefined,
            creator,
            layoutHash,
            parentId,
            playFee,
            plays,
            clears,
            likes,
            bestTimeMs,
            bestPlayer,
            active,
        };
    }

    return {
        level,
        listingPriceWei: listing?.status === 'success' ? listing.result : undefined,
        tokenURI: uri?.status === 'success' ? uri.result : undefined,
        isLoading: q.isLoading,
        error: q.error,
        refetch: q.refetch,
        enabled,
    };
}
