import { useCallback, useState } from 'react';
import type { Hash, TransactionReceipt } from 'viem';
import { zeroAddress } from 'viem';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { toast } from '../components/ui/Toast';
import { shortAddr } from '../components/ui/format';
import { getAddresses } from '../contracts/addresses';
import { api } from '../api/client';
import { chains, DEFAULT_CHAIN_ID, explorerTxUrl } from './config';
import { humanizeError } from './errors';

const SUPPORTED = new Set<number>(chains.map((c) => c.id));
export const chainName = (id?: number) => chains.find((c) => c.id === id)?.name ?? (id ? `Chain ${id}` : 'Unknown network');
export const targetChain = chains.find((c) => c.id === DEFAULT_CHAIN_ID) ?? chains[0];

/** Wallet + network + deployment readiness, used to gate every write button with a reason. */
export function useWeb3Status() {
    const { address, isConnected, chainId: walletChainId, status } = useAccount();
    const configChainId = useChainId();
    const chainId = walletChainId ?? configChainId;
    const wrongNetwork = isConnected && walletChainId !== undefined && !SUPPORTED.has(walletChainId);
    const addrs = getAddresses(chainId);
    const contractsReady = addrs.levelNFT !== zeroAddress && addrs.forgeCoin !== zeroAddress;
    /** First blocker for a write, in the order a player has to fix them. */
    const blocker: null | 'connect' | 'network' | 'contracts' = !isConnected ? 'connect' : wrongNetwork ? 'network' : !contractsReady ? 'contracts' : null;
    return { address, isConnected, connecting: status === 'connecting' || status === 'reconnecting', chainId, wrongNetwork, contractsReady, blocker };
}

export const BLOCKER_TEXT = {
    connect: 'Connect a wallet to continue.',
    network: `Switch your wallet to ${targetChain.name}.`,
    contracts: 'RealmForge contracts are not deployed on this network.',
} as const;

export type ServiceState = 'checking' | 'online' | 'offline';

/** Pings the API (/health) and the chain RPC so pages can show honest offline banners. */
export function useServiceStatus() {
    const client = usePublicClient();
    const chainId = useChainId();
    const apiQ = useQuery({ queryKey: ['svc', 'api'], queryFn: () => api.health(), retry: false, refetchInterval: 20_000, staleTime: 10_000 });
    const rpcQ = useQuery({
        queryKey: ['svc', 'rpc', chainId],
        queryFn: async () => {
            if (!client) throw new Error('no client');
            return Number(await client.getBlockNumber());
        },
        retry: false,
        refetchInterval: 20_000,
        staleTime: 10_000,
    });
    const state = (q: { isPending: boolean; isError: boolean }): ServiceState => (q.isPending ? 'checking' : q.isError ? 'offline' : 'online');
    return { api: state(apiQ), rpc: state(rpcQ), blockNumber: rpcQ.data, apiInfo: apiQ.data };
}

export interface TxCopy {
    /** e.g. "Claim 100 FORGE" */
    title: string;
    /** Shown on success. */
    success?: string;
    successBody?: string;
}

export interface TxOutcome {
    ok: boolean;
    hash?: Hash;
    receipt?: TransactionReceipt;
    error?: string;
}

/**
 * Transaction lifecycle with toasts: signing → pending (explorer link) → confirmed / failed with a
 * readable reason. `busy` holds the key of the running tx so buttons can disable themselves.
 */
export function useTxFlow() {
    const client = usePublicClient();
    const chainId = useChainId();
    const [busy, setBusy] = useState<string | null>(null);
    const [stage, setStage] = useState<'idle' | 'signing' | 'pending' | 'confirmed' | 'error'>('idle');

    const run = useCallback(
        async (key: string, copy: TxCopy, send: () => Promise<Hash | null | undefined>): Promise<TxOutcome> => {
            const id = `tx-${key}-${Date.now()}`;
            setBusy(key);
            setStage('signing');
            toast.show({ id, tone: 'pending', title: `${copy.title}: confirm in your wallet`, body: 'Review the transaction in your wallet extension.' });
            try {
                const hash = await send();
                if (!hash) {
                    toast.update(id, { tone: 'info', title: `${copy.title}: nothing to do`, duration: 3000 });
                    setStage('confirmed');
                    return { ok: true };
                }
                setStage('pending');
                const url = explorerTxUrl(chainId, hash);
                toast.update(id, {
                    tone: 'pending',
                    title: `${copy.title}: pending`,
                    body: `Tx ${shortAddr(hash, 10, 6)} sent, waiting for a block…`,
                    action: url.startsWith('http') ? { label: 'View on explorer', href: url } : undefined,
                });
                if (!client) throw new Error('No RPC client for this network');
                const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
                if (receipt.status !== 'success') throw new Error('Transaction reverted on-chain');
                setStage('confirmed');
                toast.update(id, {
                    tone: 'success',
                    title: copy.success ?? `${copy.title}: confirmed`,
                    body: copy.successBody ?? `Included in block ${receipt.blockNumber.toString()}.`,
                    action: url.startsWith('http') ? { label: 'View on explorer', href: url } : undefined,
                });
                return { ok: true, hash, receipt };
            } catch (e) {
                const msg = humanizeError(e);
                console.warn(`[tx:${key}]`, e);
                setStage('error');
                toast.update(id, { tone: 'error', title: `${copy.title} failed`, body: msg, action: undefined });
                return { ok: false, error: msg };
            } finally {
                setBusy(null);
            }
        },
        [client, chainId],
    );

    return { run, busy, stage, isBusy: (key?: string) => (key ? busy === key : busy !== null) };
}
