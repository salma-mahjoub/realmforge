import { useEffect, useState, type ReactNode } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSwitchChain } from 'wagmi';
import { AlertTriangle, ChevronDown, Database, Droplets, Menu, ServerOff, Wallet, WifiOff, X } from 'lucide-react';
import { useFaucet, useForgeBalance } from '../contracts/hooks';
import { useMockData } from '../api/dataSource';
import { API_URL } from '../api/client';
import { BLOCKER_TEXT, chainName, targetChain, useServiceStatus, useTxFlow, useWeb3Status } from '../web3/tx';
import { Avatar, Button, ForgeCoin, Skeleton, Toaster, Tooltip, cx } from './ui';

export function Logo() {
    return (
        <Link to="/" className="logo" aria-label="RealmForge home">
            <svg width="34" height="28" viewBox="0 0 64 52" aria-hidden>
                <path d="M4 22h34l10-10v10h10v8H44l-8 8v10h-8V38H14v-8L4 22z" fill="#7c5cff" />
                <path d="M50 0l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#ffc83d" />
            </svg>
            <span>RealmForge</span>
        </Link>
    );
}

const NAV = [
    { to: '/browse', label: 'Browse' },
    { to: '/editor', label: 'Editor' },
    { to: '/room/new', label: 'Race', match: '/room' },
    { to: '/market', label: 'Market' },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
    const { pathname } = useLocation();
    return (
        <>
            {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} onClick={onNavigate} className={({ isActive }) => cx('nav-link', (isActive || (n.match && pathname.startsWith(n.match))) && 'active')}>
                    {n.label}
                </NavLink>
            ))}
        </>
    );
}

/** Gold balance pill; becomes a faucet CTA when the connected wallet holds 0 FORGE. */
export function BalancePill() {
    const web3 = useWeb3Status();
    const bal = useForgeBalance();
    const faucet = useFaucet();
    const tx = useTxFlow();
    if (!web3.isConnected) return null;
    if (!web3.contractsReady || web3.wrongNetwork) {
        return (
            <Tooltip content={web3.wrongNetwork ? BLOCKER_TEXT.network : BLOCKER_TEXT.contracts}>
                <span className="forge-pill is-muted" tabIndex={0}>
                    <ForgeCoin size={18} /> — FORGE
                </span>
            </Tooltip>
        );
    }
    if (bal.isLoading) {
        return (
            <span className="forge-pill">
                <ForgeCoin size={18} /> <Skeleton w={48} h={14} />
            </span>
        );
    }
    if (bal.value === 0n && faucet.claimed !== true) {
        return (
            <Button
                variant="gold"
                size="sm"
                icon={<Droplets size={15} aria-hidden />}
                loading={tx.isBusy('faucet')}
                onClick={() => void tx.run('faucet', { title: 'Claim 100 FORGE', success: '100 FORGE added to your wallet' }, faucet.claim).then((r) => r.ok && void bal.refetch())}
                title="ForgeCoin.claimFaucet(): 100 FORGE once per address"
            >
                Get 100 FORGE
            </Button>
        );
    }
    return (
        <Link to={web3.address ? `/profile/${web3.address}` : '/'} className="forge-pill" title="Your FORGE balance (ERC-20)">
            <ForgeCoin size={18} /> {bal.formatted ?? '—'}
            <span className="pill-sym">FORGE</span>
        </Link>
    );
}

export function WalletChip() {
    return (
        <ConnectButton.Custom>
            {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted, connectModalOpen }) => {
                if (!mounted) return <Skeleton w={140} h={36} r={10} />;
                if (!account || !chain) {
                    return (
                        <Button variant="primary" icon={<Wallet size={16} aria-hidden />} onClick={openConnectModal} loading={connectModalOpen}>
                            Connect wallet
                        </Button>
                    );
                }
                return (
                    <div className="wallet-group">
                        <button type="button" className="chip" onClick={openAccountModal} aria-label={`Account ${account.address}, open account menu`}>
                            <Avatar address={account.address} size={20} />
                            <span className="chip-text">{account.displayName}</span>
                            <ChevronDown size={14} aria-hidden />
                        </button>
                        <button type="button" className={cx('chip', chain.unsupported && 'chip-danger')} onClick={openChainModal} aria-label={chain.unsupported ? 'Wrong network, switch network' : `Network ${chain.name}, switch network`}>
                            <span className={cx('dot', chain.unsupported ? 'dot-red' : 'dot-green')} aria-hidden />
                            <span className="chip-text">{chain.unsupported ? 'Wrong network' : chain.name}</span>
                        </button>
                    </div>
                );
            }}
        </ConnectButton.Custom>
    );
}

function useDismiss(key: string) {
    const [hidden, setHidden] = useState(() => {
        try {
            return sessionStorage.getItem(`rf:dismiss:${key}`) === '1';
        } catch {
            return false;
        }
    });
    const dismiss = () => {
        setHidden(true);
        try {
            sessionStorage.setItem(`rf:dismiss:${key}`, '1');
        } catch {
            /* storage disabled */
        }
    };
    return [hidden, dismiss] as const;
}

/** Wrong network, deployment, chain and API availability, in that order of urgency. */
function StatusBanners() {
    const web3 = useWeb3Status();
    const svc = useServiceStatus();
    const mock = useMockData();
    const { switchChain, isPending } = useSwitchChain();
    const [apiHidden, dismissApi] = useDismiss('api');

    const banners: ReactNode[] = [];
    if (web3.wrongNetwork) {
        banners.push(
            <div key="net" className="banner banner-danger" role="alert">
                <AlertTriangle size={16} aria-hidden />
                <span>
                    Your wallet is on <b>{chainName(web3.chainId)}</b>. RealmForge runs on <b>{targetChain.name}</b>.
                </span>
                <Button size="sm" variant="danger" loading={isPending} onClick={() => switchChain({ chainId: targetChain.id })}>
                    Switch to {targetChain.name}
                </Button>
            </div>,
        );
    } else if (web3.isConnected && !web3.contractsReady) {
        banners.push(
            <div key="contracts" className="banner banner-warn" role="status">
                <AlertTriangle size={16} aria-hidden />
                <span>
                    No RealmForge contracts on <b>{chainName(web3.chainId)}</b>. Run <code>npm run deploy:local</code> or set the <code>VITE_*_ADDRESS</code> variables.
                </span>
            </div>,
        );
    }
    if (svc.rpc === 'offline' && web3.isConnected) {
        banners.push(
            <div key="rpc" className="banner banner-warn" role="status">
                <WifiOff size={16} aria-hidden />
                <span>
                    {chainName(web3.chainId)} RPC is unreachable: on-chain stats and transactions are unavailable{web3.chainId === 31337 ? ' (start it with npm run dev:chain)' : ''}.
                </span>
            </div>,
        );
    }
    if ((svc.api === 'offline' || mock) && !apiHidden) {
        banners.push(
            <div key="api" className="banner banner-info" role="status">
                {svc.api === 'offline' ? <ServerOff size={16} aria-hidden /> : <Database size={16} aria-hidden />}
                <span>
                    {svc.api === 'offline' ? (
                        <>
                            Game server offline ({API_URL.replace(/^https?:\/\//, '')}). Showing <b>sample data</b>; publishing, run validation and races need <code>npm run dev:server</code>.
                        </>
                    ) : (
                        <>
                            Some panels show <b>sample data</b> until the server exposes their endpoints.
                        </>
                    )}
                </span>
                <button type="button" className="icon-btn icon-btn-xs" aria-label="Dismiss notice" onClick={dismissApi}>
                    <X size={14} />
                </button>
            </div>,
        );
    }
    if (!banners.length) return null;
    return <div className="banners">{banners}</div>;
}

export function Layout() {
    const { pathname } = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);
    const fullBleed = pathname.startsWith('/editor');
    useEffect(() => {
        setMenuOpen(false);
        window.scrollTo({ top: 0 });
    }, [pathname]);

    return (
        <div className={cx('app', fullBleed && 'app-full')}>
            <a href="#main" className="skip-link">
                Skip to content
            </a>
            <header className="nav">
                <div className="nav-inner">
                    <Logo />
                    <nav className="nav-links" aria-label="Main">
                        <NavLinks />
                    </nav>
                    <div className="nav-right">
                        <BalancePill />
                        <WalletChip />
                        <button type="button" className="icon-btn nav-burger" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="mobile-nav" onClick={() => setMenuOpen((v) => !v)}>
                            {menuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>
                {menuOpen && (
                    <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile">
                        <NavLinks onNavigate={() => setMenuOpen(false)} />
                    </nav>
                )}
            </header>
            <StatusBanners />
            <main id="main" className={fullBleed ? 'main main-full' : 'main'} tabIndex={-1}>
                <Outlet />
            </main>
            <Toaster />
        </div>
    );
}
