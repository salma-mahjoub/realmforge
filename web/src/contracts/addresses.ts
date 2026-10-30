import { getAddress, isAddress, zeroAddress, type Address } from 'viem';

/**
 * Contract addresses, env-driven (see .env.example). Per-chain overrides can be added to
 * `byChain` once contracts/ exports a deployments file.
 */
function envAddress(value: string | undefined, name: string): Address {
    if (value && isAddress(value)) return getAddress(value);
    if (value) console.warn(`[contracts] ${name}="${value}" is not a valid address`);
    return zeroAddress;
}

export const LEVEL_NFT_ADDRESS: Address = envAddress(import.meta.env.VITE_LEVEL_NFT_ADDRESS, 'VITE_LEVEL_NFT_ADDRESS');
export const FORGE_COIN_ADDRESS: Address = envAddress(import.meta.env.VITE_FORGE_COIN_ADDRESS, 'VITE_FORGE_COIN_ADDRESS');

export interface ContractAddresses {
    levelNFT: Address;
    forgeCoin: Address;
}

/** Per-chain overrides (chainId -> addresses). Empty until deployments exist. */
const byChain: Partial<Record<number, ContractAddresses>> = {};

export function getAddresses(chainId?: number): ContractAddresses {
    return (chainId !== undefined && byChain[chainId]) || { levelNFT: LEVEL_NFT_ADDRESS, forgeCoin: FORGE_COIN_ADDRESS };
}

export const contractsConfigured = LEVEL_NFT_ADDRESS !== zeroAddress && FORGE_COIN_ADDRESS !== zeroAddress;
