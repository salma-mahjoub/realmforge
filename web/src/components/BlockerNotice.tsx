import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useSwitchChain } from 'wagmi';
import { AlertTriangle, Wallet } from 'lucide-react';
import { BLOCKER_TEXT, targetChain, useWeb3Status } from '../web3/tx';
import { Button } from './ui';

/** Inline reason a write is blocked, with the one-click fix (connect / switch network). */
export function BlockerNotice({ compact }: { compact?: boolean }) {
    const web3 = useWeb3Status();
    const { openConnectModal } = useConnectModal();
    const { switchChain, isPending } = useSwitchChain();
    if (!web3.blocker) return null;
    return (
        <div className={compact ? 'notice notice-warn notice-compact' : 'notice notice-warn'} role="status">
            <AlertTriangle size={16} aria-hidden />
            <span>{BLOCKER_TEXT[web3.blocker]}</span>
            {web3.blocker === 'connect' && (
                <Button size="sm" variant="primary" icon={<Wallet size={14} aria-hidden />} onClick={openConnectModal}>
                    Connect
                </Button>
            )}
            {web3.blocker === 'network' && (
                <Button size="sm" variant="danger" loading={isPending} onClick={() => switchChain({ chainId: targetChain.id })}>
                    Switch to {targetChain.name}
                </Button>
            )}
        </div>
    );
}
