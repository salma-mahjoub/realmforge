import { useChainId } from 'wagmi';
import { levelNftAbi } from '../generated';
import { getAddresses } from '../addresses';
import { useTx } from './useTx';
import type { PublishArgs } from './types';

/**
 * Step 4 of the publish flow (SPEC §3.3): `LevelNFT.publish(...)`.
 * Steps 1–3 (clear proof, thumbnail, IPFS pin) live in src/api + the Editor page.
 */
export function usePublishLevel() {
    const chainId = useChainId();
    const { levelNFT } = getAddresses(chainId);
    const tx = useTx();

    const publish = (a: PublishArgs) =>
        tx.write.writeContractAsync({
            address: levelNFT,
            abi: levelNftAbi,
            functionName: 'publish',
            args: [a.layoutHash, a.uri, a.playFee, a.parentId, a.deadline, a.clearSig],
        });

    // TODO: parse LevelPublished from tx.receipt.data.logs to return the minted token id.
    return { publish, ...tx };
}
