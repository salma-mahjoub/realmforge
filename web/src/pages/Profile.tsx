import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatEther, isAddress, type Address } from 'viem';
import { useReadContract, useWriteContract } from 'wagmi';
import { Droplets, Hammer, History, Layers, RefreshCw, Trophy, UserX, Wallet } from 'lucide-react';
import { api } from '../api/client';
import { useMockData } from '../api/dataSource';
import { AddressChip, Avatar, Badge, Button, Card, EmptyState, LevelGrid, Skeleton, Stat, Tabs, TokenAmount, formatMs, shortAddr } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { useFaucet, useForgeBalance } from '../contracts/hooks';
import { levelNftAbi } from '../contracts/generated';
import { getAddresses } from '../contracts/addresses';
import { useServiceStatus, useTxFlow, useWeb3Status } from '../web3/tx';
import { BlockerNotice } from '../components/BlockerNotice';

type Tab = 'created' | 'owned' | 'history';

export default function Profile() {
    const param = useParams().address ?? '';
    const valid = isAddress(param);
    const address = param as Address;
    const web3 = useWeb3Status();
    const svc = useServiceStatus();
    const { data: p, error, reload } = useAsync(() => (valid ? api.getProfile(address) : Promise.reject(new Error('invalid'))), [param]);
    const bal = useForgeBalance(valid ? address : undefined);
    const faucet = useFaucet();
    const tx = useTxFlow();
    const mock = useMockData('/profiles/:address');
    const [tab, setTab] = useState<Tab>('created');
    const isMe = web3.address?.toLowerCase() === param.toLowerCase();
    const { levelNFT } = getAddresses(web3.chainId);
    const pending = useReadContract({ address: levelNFT, abi: levelNftAbi, functionName: 'pendingWithdrawals', args: [address], query: { enabled: valid && web3.contractsReady } });
    const withdrawW = useWriteContract();

    if (!valid) {
        return (
            <EmptyState tone="error" icon={<UserX size={26} />} title="Not a valid address" action={<Button to="/browse">Browse levels</Button>}>
                “{param}” is not an Ethereum address. Profiles live at /profile/0x… (40 hex characters).
            </EmptyState>
        );
    }
    if (error && !p) {
        return (
            <EmptyState tone="error" title="Profile could not be loaded" action={<Button icon={<RefreshCw size={15} aria-hidden />} onClick={reload}>Retry</Button>}>
                {error.message}
            </EmptyState>
        );
    }

    const onChainBalance = bal.enabled && bal.value !== undefined;
    const chainDown = svc.rpc === 'offline' || Boolean(bal.error);
    const balanceZero = onChainBalance && bal.value === 0n;
    const pendingWei = pending.data as bigint | undefined;

    const claim = () => void tx.run('faucet', { title: 'Claim 100 FORGE', success: '100 FORGE added to your wallet' }, faucet.claim).then((r) => r.ok && void bal.refetch());
    const withdraw = () =>
        void tx.run('withdraw', { title: 'Withdraw sales + royalties', success: 'ETH sent to your wallet' }, () => withdrawW.writeContractAsync({ address: levelNFT, abi: levelNftAbi, functionName: 'withdraw', args: [] })).then((r) => r.ok && void pending.refetch());

    return (
        <div className="page page-profile">
            <Card className="profile-head">
                <div className="profile-id">
                    <Avatar address={address} size={64} />
                    <div>
                        <h1 className="page-title">
                            {shortAddr(address)} {isMe && <Badge tone="violet">You</Badge>} {mock && <Badge tone="neutral">Sample stats</Badge>}
                        </h1>
                        <AddressChip address={address} link={false} label={address} className="address-full" />
                    </div>
                </div>
                <div className="profile-wallet">
                    <div className="profile-balance">
                        <span className="stat-label">FORGE balance</span>
                        {bal.isLoading && !chainDown ? <Skeleton w={120} h={28} /> : <TokenAmount value={onChainBalance ? Number(formatEther(bal.value!)) : p ? p.forgeBalance : null} size="xl" />}
                        {!onChainBalance && <span className="fine">{chainDown || !web3.contractsReady ? 'Sample figure: chain not reachable' : 'Reading chain…'}</span>}
                    </div>
                    {pendingWei !== undefined && pendingWei > 0n && (
                        <div className="profile-balance">
                            <span className="stat-label">Withdrawable (sales + royalties)</span>
                            <TokenAmount value={formatEther(pendingWei)} symbol="ETH" size="lg" maxFrac={6} />
                            {isMe && (
                                <Button size="sm" icon={<Wallet size={14} aria-hidden />} loading={tx.isBusy('withdraw')} onClick={withdraw}>
                                    Withdraw
                                </Button>
                            )}
                        </div>
                    )}
                    {isMe && (balanceZero || faucet.canClaim) && (
                        <div className="faucet-cta">
                            <div>
                                <b>{balanceZero ? 'Your wallet has 0 FORGE' : 'Free starter FORGE'}</b>
                                <span>Claim 100 FORGE once per address to pay play fees and race stakes.</span>
                            </div>
                            <Button variant="gold" icon={<Droplets size={16} aria-hidden />} loading={tx.isBusy('faucet')} disabled={faucet.claimed === true} onClick={claim}>
                                {faucet.claimed ? 'Faucet claimed' : 'Claim 100 FORGE'}
                            </Button>
                        </div>
                    )}
                </div>
            </Card>
            {isMe && web3.blocker && web3.blocker !== 'connect' && <BlockerNotice />}

            <div className="stat-strip">
                <Stat icon={<Hammer size={20} />} label="Levels created" value={p?.created.length ?? '—'} loading={!p} />
                <Stat icon={<Layers size={20} />} label="Levels owned" value={p?.owned.length ?? '—'} loading={!p} />
                <Stat icon={<Trophy size={20} />} label="Clears" value={p?.clears ?? '—'} loading={!p} />
                <Stat icon={<History size={20} />} label="Best rank" value={p?.bestRank ? `#${p.bestRank}` : '—'} loading={!p} />
            </div>

            <Tabs
                label="Profile sections"
                variant="underline"
                idBase="profile"
                value={tab}
                onChange={setTab}
                items={[
                    { id: 'created', label: 'Created', count: p?.created.length },
                    { id: 'owned', label: 'Owned', count: p?.owned.length },
                    { id: 'history', label: 'Run history', count: p?.recentClears.length },
                ]}
            />
            <div id="profile-panel" role="tabpanel" aria-labelledby={`profile-tab-${tab}`} className="tab-body">
                {!p ? (
                    <LevelGrid loading count={4} />
                ) : tab !== 'history' ? (
                    (tab === 'created' ? p.created : p.owned).length ? (
                        <LevelGrid levels={tab === 'created' ? p.created : p.owned} />
                    ) : (
                        <EmptyState icon={<Hammer size={24} />} title={tab === 'created' ? 'No levels created yet' : 'No levels owned yet'} action={isMe ? <Button to={tab === 'created' ? '/editor' : '/market'} variant="primary">{tab === 'created' ? 'Open the editor' : 'Visit the market'}</Button> : undefined}>
                            {tab === 'created' ? 'Published levels appear here as LevelNFTs.' : 'Bought or minted LevelNFTs appear here.'}
                        </EmptyState>
                    )
                ) : p.recentClears.length ? (
                    <Card pad={false}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th scope="col">Level</th>
                                    <th scope="col" className="num-col">
                                        Time
                                    </th>
                                    <th scope="col" className="num-col">
                                        Reward
                                    </th>
                                    <th scope="col" className="num-col">
                                        When
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {p.recentClears.map((c) => (
                                    <tr key={c.level.id}>
                                        <td>
                                            <Link to={`/level/${c.level.id}`}>
                                                #{c.level.id} {c.level.name}
                                            </Link>
                                        </td>
                                        <td className="num-col num">{formatMs(c.timeMs)}</td>
                                        <td className="num-col">
                                            <TokenAmount value={c.reward} sign="+" size="sm" />
                                        </td>
                                        <td className="num-col fine">{c.ago}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Card>
                ) : (
                    <EmptyState icon={<History size={24} />} title="No settled runs yet" action={<Button to="/browse" variant="primary">Find a level</Button>}>
                        Cleared runs settled on-chain show up here with their reward.
                    </EmptyState>
                )}
            </div>
        </div>
    );
}
