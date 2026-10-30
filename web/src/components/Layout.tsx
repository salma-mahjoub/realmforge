import { ConnectButton } from '@rainbow-me/rainbowkit';
import { NavLink, Outlet, Link, useLocation } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { useForgeBalance } from '../contracts/hooks';
import { contractsConfigured } from '../contracts/addresses';

export function Logo() {
    return (
        <Link to="/" className="logo" aria-label="RealmForge home">
            <svg width="34" height="28" viewBox="0 0 64 52" aria-hidden>
                <path d="M4 22h34l10-10v10h10v8H44l-8 8v10h-8V38H14v-8L4 22z" fill="#7c5cff" />
                <path d="M50 0l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#ffc83d" />
            </svg>
            RealmForge
        </Link>
    );
}

export function ForgePill() {
    const { isConnected } = useAccount();
    const bal = useForgeBalance();
    // Demo figure (mockups) until contracts are deployed/configured.
    const text = bal.enabled ? (bal.formatted ?? '…') : isConnected || !contractsConfigured ? '1,240' : '—';
    return (
        <span className="forge-pill" title={contractsConfigured ? 'FORGE balance' : 'Demo balance — set VITE_FORGE_COIN_ADDRESS'}>
            <span className="coin" /> {text} FORGE
        </span>
    );
}

export function WalletChip() {
    return (
        <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
                if (!mounted) return null;
                if (!account || !chain) {
                    return (
                        <button className="btn primary" onClick={openConnectModal}>
                            Connect wallet
                        </button>
                    );
                }
                return (
                    <>
                        <button className="chip" onClick={openAccountModal}>
                            <WalletIcon /> <span className="mono">{account.displayName}</span> ▾
                        </button>
                        <button className="chip" onClick={openChainModal} style={chain.unsupported ? { borderColor: 'var(--red)' } : undefined}>
                            <span className="dot" style={chain.unsupported ? { background: 'var(--red)' } : undefined} />
                            {chain.unsupported ? 'Wrong network' : chain.name}
                        </button>
                    </>
                );
            }}
        </ConnectButton.Custom>
    );
}

function WalletIcon() {
    return (
        <svg width="18" height="16" viewBox="0 0 24 20" aria-hidden>
            <rect x="1" y="3" width="22" height="16" rx="3" fill="none" stroke="#c9cff5" strokeWidth="2" />
            <rect x="15" y="9" width="6" height="4" rx="1" fill="#c9cff5" />
        </svg>
    );
}

export function Layout() {
    const { pathname } = useLocation();
    const fullBleed = pathname.startsWith('/editor');
    return (
        <div className="app">
            <header className="nav">
                <Logo />
                <nav className="nav-links">
                    <NavLink to="/browse">Browse</NavLink>
                    <NavLink to="/editor">Editor</NavLink>
                    <NavLink to="/room/new" className={() => (pathname.startsWith('/room') ? 'active' : '')}>
                        Race
                    </NavLink>
                    <NavLink to="/market">Market</NavLink>
                </nav>
                <div className="nav-right">
                    <ForgePill />
                    <WalletChip />
                </div>
            </header>
            <main className={fullBleed ? 'main full' : 'main'}>
                <Outlet />
            </main>
        </div>
    );
}
