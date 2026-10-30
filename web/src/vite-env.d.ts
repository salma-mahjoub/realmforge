/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_DEFAULT_CHAIN_ID?: string;
    readonly VITE_LOCAL_RPC_URL?: string;
    readonly VITE_SEPOLIA_RPC_URL?: string;
    readonly VITE_LEVEL_NFT_ADDRESS?: string;
    readonly VITE_FORGE_COIN_ADDRESS?: string;
    readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
    readonly VITE_API_URL?: string;
    readonly VITE_GAME_SERVER_URL?: string;
    readonly VITE_IPFS_GATEWAY?: string;
    readonly VITE_USE_MOCKS?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
