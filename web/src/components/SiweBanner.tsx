import { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { useServiceStatus, useWeb3Status } from '../web3/tx';
import { humanizeError, isUserRejection } from '../web3/errors';
import { useSiwe } from '../web3/siwe';
import { Button, toast } from './ui';

/**
 * Shown once a wallet is connected and has no sign-in session yet: asks for ONE free EIP-4361 signature and says
 * what it is for. Race and co-op rooms refuse players without it; the lobby also asks on join, so dismissing
 * the banner only postpones the prompt.
 */
export function SiweBanner() {
    const web3 = useWeb3Status();
    const svc = useServiceStatus();
    const siwe = useSiwe();
    const [dismissed, setDismissed] = useState<string | null>(null);
    if (!web3.address || web3.wrongNetwork || svc.api !== 'online' || siwe.signedIn || dismissed === web3.address) return null;

    const signIn = async () => {
        try {
            await siwe.signIn();
            toast.success('Signed in', 'Your wallet is verified for race and co-op rooms on this browser for the next hour.');
        } catch (e) {
            const text = humanizeError(e);
            toast.show({ tone: isUserRejection(text) ? 'warning' : 'error', title: 'Sign-in not completed', body: isUserRejection(text) ? 'You declined the signature. Rooms will ask again when you join one.' : text });
        }
    };

    return (
        <div className="banners">
            <div className="banner banner-info" role="status">
                <KeyRound size={16} aria-hidden />
                <span>
                    <b>Sign in with Ethereum</b>: one free signature (no transaction, no gas) proves this wallet is yours. Race and co-op rooms require it, so nobody can join or be paid in your name. It stays valid for 1 hour on this browser.
                </span>
                <Button size="sm" variant="primary" loading={siwe.busy} onClick={() => void signIn()}>
                    Sign message
                </Button>
                <button type="button" className="icon-btn icon-btn-xs" aria-label="Not now" onClick={() => setDismissed(web3.address ?? null)}>
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}
