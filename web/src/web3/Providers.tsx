import '@rainbow-me/rainbowkit/styles.css';
import type { ReactNode } from 'react';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { DEFAULT_CHAIN_ID, wagmiConfig } from './config';

const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false } },
});

const theme = darkTheme({
    accentColor: '#7c5cff',
    accentColorForeground: '#ffffff',
    borderRadius: 'medium',
    overlayBlur: 'small',
});
theme.colors.modalBackground = '#151b30';
theme.colors.connectButtonBackground = '#151b30';

export function Web3Providers({ children }: { children: ReactNode }) {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider theme={theme} initialChain={DEFAULT_CHAIN_ID} modalSize="compact">
                    {children}
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}
