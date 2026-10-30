import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Based on phaserjs/template-react-ts (MIT) — see LICENSE.template-react-ts.
// The template's log.js telemetry ping was intentionally removed.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            // Sibling standalone package (written by game-core). Not imported yet — see
            // src/game/player/PlayerAdapter.ts for the integration TODO.
            '@realmforge/game-core': fileURLToPath(new URL('../game-core/src', import.meta.url)),
        },
    },
    server: {
        port: 8080,
        fs: { allow: ['..'] },
    },
    build: {
        target: 'es2022',
        chunkSizeWarningLimit: 2000,
        rollupOptions: {
            onwarn(warning, warn) {
                // noisy, harmless annotations inside wallet SDK deps (ox, walletconnect)
                if (warning.code === 'INVALID_ANNOTATION' || warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
                warn(warning);
            },
            output: {
                manualChunks: {
                    phaser: ['phaser'],
                    web3: ['wagmi', 'viem', '@rainbow-me/rainbowkit', '@tanstack/react-query'],
                },
            },
        },
    },
});
