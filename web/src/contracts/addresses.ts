import { getAddress, isAddress, zeroAddress, type Address } from 'viem';
import { deployedAddresses } from './generated';

/**
 * Contract addresses: env vars (VITE_LEVEL_NFT_ADDRESS / VITE_FORGE_COIN_ADDRESS, written to
 * .env.local by `npm run deploy:local`) win; otherwise the per-chain map exported by
 * contracts/scripts/export-abi.ts (generated/addresses.json) is used.
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

const byChain: Partial<Record<number, ContractAddresses>> = Object.fromEntries(
    Object.entries(deployedAddresses)
        .filter(([, a]) => a.LevelNFT && a.ForgeCoin && isAddress(a.LevelNFT) && isAddress(a.ForgeCoin))
        .map(([chain, a]) => [Number(chain), { levelNFT: getAddress(a.LevelNFT!), forgeCoin: getAddress(a.ForgeCoin!) }]),
);

export function getAddresses(chainId?: number): ContractAddresses {
    if (LEVEL_NFT_ADDRESS !== zeroAddress && FORGE_COIN_ADDRESS !== zeroAddress) return { levelNFT: LEVEL_NFT_ADDRESS, forgeCoin: FORGE_COIN_ADDRESS };
    return (chainId !== undefined && byChain[chainId]) || { levelNFT: LEVEL_NFT_ADDRESS, forgeCoin: FORGE_COIN_ADDRESS };
}

export const contractsConfigured =
    (LEVEL_NFT_ADDRESS !== zeroAddress && FORGE_COIN_ADDRESS !== zeroAddress) || Object.keys(byChain).length > 0;
