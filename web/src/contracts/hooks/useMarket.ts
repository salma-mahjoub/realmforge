import { useChainId } from 'wagmi';
import { parseEther } from 'viem';
import { levelNftAbi } from '../generated';
import { getAddresses } from '../addresses';
import { useTx } from './useTx';

/** Fixed-price NFT market (SPEC §4.2): `list(id, priceWei)`, `unlist(id)`, `buy(id)` payable, `like(id)`. */
export function useMarket() {
    const chainId = useChainId();
    const { levelNFT } = getAddresses(chainId);
    const tx = useTx();

    const list = (id: bigint, priceEth: string) =>
        tx.write.writeContractAsync({ address: levelNFT, abi: levelNftAbi, functionName: 'list', args: [id, parseEther(priceEth)] });
    const unlist = (id: bigint) => tx.write.writeContractAsync({ address: levelNFT, abi: levelNftAbi, functionName: 'unlist', args: [id] });
    const buy = (id: bigint, priceWei: bigint) =>
        tx.write.writeContractAsync({ address: levelNFT, abi: levelNftAbi, functionName: 'buy', args: [id], value: priceWei });

    const like = (id: bigint) => tx.write.writeContractAsync({ address: levelNFT, abi: levelNftAbi, functionName: 'like', args: [id] });

    return { list, unlist, buy, like, ...tx };
}
