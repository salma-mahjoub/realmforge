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
export const REALM_BADGES_ADDRESS: Address = envAddress(import.meta.env.VITE_REALM_BADGES_ADDRESS, 'VITE_REALM_BADGES_ADDRESS');

export interface ContractAddresses {
    levelNFT: Address;
    forgeCoin: Address;
    realmBadges: Address;
}

const byChain: Partial<Record<number, ContractAddresses>> = Object.fromEntries(
    Object.entries(deployedAddresses)
        .filter(([, a]) => a.LevelNFT && a.ForgeCoin && isAddress(a.LevelNFT) && isAddress(a.ForgeCoin))
        .map(([chain, a]) => [Number(chain), { levelNFT: getAddress(a.LevelNFT!), forgeCoin: getAddress(a.ForgeCoin!), realmBadges: a.RealmBadges && isAddress(a.RealmBadges) ? getAddress(a.RealmBadges) : zeroAddress }]),
);

/** Chain the env addresses were deployed on (`npm run deploy:local` writes 31337; a Sepolia build sets 11155111). */
const ENV_CHAIN_ID = Number(import.meta.env.VITE_DEFAULT_CHAIN_ID) || 31337;
const envConfigured = LEVEL_NFT_ADDRESS !== zeroAddress && FORGE_COIN_ADDRESS !== zeroAddress;

/**
 * Addresses for the chain the wallet is on. The env addresses only apply to the chain they were deployed on:
 * using them on another chain sends transactions to an empty address, which "succeeds" without doing anything.
 * An unknown chain gets zero addresses, so the UI shows "contracts are not deployed on this network".
 */
export function getAddresses(chainId?: number): ContractAddresses {
    if (envConfigured && (chainId === undefined || chainId === ENV_CHAIN_ID)) return { levelNFT: LEVEL_NFT_ADDRESS, forgeCoin: FORGE_COIN_ADDRESS, realmBadges: REALM_BADGES_ADDRESS };
    return (chainId !== undefined && byChain[chainId]) || { levelNFT: zeroAddress, forgeCoin: zeroAddress, realmBadges: zeroAddress };
}

export const contractsConfigured =
    (LEVEL_NFT_ADDRESS !== zeroAddress && FORGE_COIN_ADDRESS !== zeroAddress) || Object.keys(byChain).length > 0;
