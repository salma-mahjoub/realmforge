import { useChainId, usePublicClient, useReadContract } from 'wagmi';
import { formatEther, parseEther } from 'viem';
import { levelAuctionAbi, levelNftAbi } from '../generated';
import { getAddresses } from '../addresses';
import { useTx } from './useTx';

export function useAuction(id?: bigint) {
    const chainId = useChainId();
    const { levelAuction, levelNFT } = getAddresses(chainId);
    const client = usePublicClient();
    const tx = useTx();
    const read = useReadContract({ address: levelAuction, abi: levelAuctionAbi, functionName: 'auctions', args: [id ?? 0n], query: { enabled: Boolean(id && levelAuction !== '0x0000000000000000000000000000000000000000'), refetchInterval: 3_000 } });
    const create = async (tokenId: bigint, reserveEth: string, incrementEth: string, duration: bigint) => {
        // The approval must be mined before createAuction, or the escrow transfer fails its pre-check.
        const approval = await tx.write.writeContractAsync({ address: levelNFT, abi: levelNftAbi, functionName: 'approve', args: [levelAuction, tokenId] });
        if (!client) throw new Error('No RPC client for this network');
        const receipt = await client.waitForTransactionReceipt({ hash: approval });
        if (receipt.status !== 'success') throw new Error('Approval reverted');
        return tx.write.writeContractAsync({ address: levelAuction, abi: levelAuctionAbi, functionName: 'createAuction', args: [tokenId, parseEther(reserveEth), parseEther(incrementEth), duration] });
    };
    const bid = (tokenId: bigint, amount: string) => tx.write.writeContractAsync({ address: levelAuction, abi: levelAuctionAbi, functionName: 'bid', args: [tokenId], value: parseEther(amount) });
    const settle = (tokenId: bigint) => tx.write.writeContractAsync({ address: levelAuction, abi: levelAuctionAbi, functionName: 'settle', args: [tokenId] });
    const withdraw = () => tx.write.writeContractAsync({ address: levelAuction, abi: levelAuctionAbi, functionName: 'withdraw' });
    const cancel = (tokenId: bigint) => tx.write.writeContractAsync({ address: levelAuction, abi: levelAuctionAbi, functionName: 'cancelAuction', args: [tokenId] });
    const auction = read.data ? { seller: read.data[0], highestBidder: read.data[1], endTime: Number(read.data[2]), reserve: read.data[3], highestBid: read.data[4], minIncrement: read.data[5], settled: read.data[6] } : undefined;
    return { ...tx, auction, create, bid, settle, withdraw, cancel, levelAuction, formatEther };
}
