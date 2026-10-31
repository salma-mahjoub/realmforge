import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import App from './App';
import { Web3Providers } from './web3/Providers';
import './styles/tokens.css';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Web3Providers>
            <App />
        </Web3Providers>
    </StrictMode>,
);
