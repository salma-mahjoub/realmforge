import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { hardhat, sepolia } from 'wagmi/chains';

/**
 * wagmi v2 + RainbowKit config. Chains: local hardhat/anvil node (31337) and Sepolia.
 * `VITE_WALLETCONNECT_PROJECT_ID` is only needed for WalletConnect-based wallets; injected
 * wallets (MetaMask, Rabby…) work with the placeholder id in local dev.
 */
const projectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'realmforge-local-dev';

export const chains = [hardhat, sepolia] as const;
export type SupportedChainId = (typeof chains)[number]['id'];

export const DEFAULT_CHAIN_ID: SupportedChainId =
    Number(import.meta.env.VITE_DEFAULT_CHAIN_ID) === sepolia.id ? sepolia.id : hardhat.id;

export const wagmiConfig = getDefaultConfig({
    appName: 'RealmForge',
    appDescription: 'Build platformer levels, publish them as NFTs, earn FORGE.',
    appUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8080',
    projectId,
    chains,
    transports: {
        [hardhat.id]: http(import.meta.env.VITE_LOCAL_RPC_URL || 'http://127.0.0.1:8545'),
        [sepolia.id]: http(import.meta.env.VITE_SEPOLIA_RPC_URL || undefined),
    },
    ssr: false,
});

declare module 'wagmi' {
    interface Register {
        config: typeof wagmiConfig;
    }
}

export const explorerTxUrl = (chainId: number, hash: string) =>
    chainId === sepolia.id ? `https://sepolia.etherscan.io/tx/${hash}` : `#tx-${hash}`;

export const explorerAddressUrl = (chainId: number, address: string) =>
    chainId === sepolia.id ? `https://sepolia.etherscan.io/address/${address}` : `#address-${address}`;
