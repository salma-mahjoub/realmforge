import { useChainId, usePublicClient, useSignTypedData } from 'wagmi';
import { parseSignature, type Hex } from 'viem';
import { forgeCoinAbi, levelNftAbi } from '../generated';
import { getAddresses } from '../addresses';
import { useTx } from './useTx';
import type { RunResult } from './types';

/**
 * `ForgeCoin.settleRun(RunResult, sig)` (SPEC §5.3) after an ERC-20 `approve`, or in one tx with
 * `settleRunWithPermit(RunResult, sig, uint8 v, bytes32 r, bytes32 s, permitDeadline)` (ERC-2612).
 */
export function useSettleRun() {
    const chainId = useChainId();
    const { forgeCoin, levelNFT } = getAddresses(chainId);
    const client = usePublicClient();
    const tx = useTx();
    const typed = useSignTypedData();

    const playFee = async (levelId: bigint) => {
        if (!client) throw new Error('No RPC client');
        const [, , fee] = await client.readContract({ address: levelNFT, abi: levelNftAbi, functionName: 'levelInfo', args: [levelId] });
        return fee;
    };

    const settle = (result: RunResult, sig: Hex) =>
        tx.write.writeContractAsync({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'settleRun', args: [result, sig] });

    const approveFee = async (levelId: bigint) => {
        const fee = await playFee(levelId);
        if (fee === 0n) return null;
        return tx.write.writeContractAsync({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'approve', args: [forgeCoin, fee] });
    };

    /** Signs an ERC-2612 permit for the play fee, then settles in a single transaction. */
    const settleWithPermit = async (result: RunResult, sig: Hex, permitTtlSec = 3600) => {
        if (!client) throw new Error('No RPC client');
        const fee = await playFee(result.levelId);
        const nonce = await client.readContract({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'nonces', args: [result.player] });
        const name = await client.readContract({ address: forgeCoin, abi: forgeCoinAbi, functionName: 'name' });
        const permitDeadline = BigInt(Math.floor(Date.now() / 1000) + permitTtlSec);
        const permitSig = await typed.signTypedDataAsync({
            domain: { name, version: '1', chainId, verifyingContract: forgeCoin },
            types: {
                Permit: [
                    { name: 'owner', type: 'address' },
                    { name: 'spender', type: 'address' },
                    { name: 'value', type: 'uint256' },
                    { name: 'nonce', type: 'uint256' },
                    { name: 'deadline', type: 'uint256' },
                ],
            },
            primaryType: 'Permit',
            message: { owner: result.player, spender: forgeCoin, value: fee, nonce, deadline: permitDeadline },
        });
        const { r, s, yParity, v } = parseSignature(permitSig);
        const v8 = Number(v ?? BigInt(yParity + 27));
        return tx.write.writeContractAsync({
            address: forgeCoin,
            abi: forgeCoinAbi,
            functionName: 'settleRunWithPermit',
            args: [result, sig, v8, r, s, permitDeadline],
        });
    };

    return { settle, settleWithPermit, approveFee, ...tx };
}
