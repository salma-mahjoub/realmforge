import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { isAddress, type Address } from 'viem';
import { useAccount } from 'wagmi';
import { api } from '../api/client';
import { Avatar, LevelCard, formatMs, shortAddr } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { useFaucet, useForgeBalance } from '../contracts/hooks';

type Tab = 'created' | 'owned' | 'clears';

export default function Profile() {
    const param = useParams().address ?? '';
    const { address: me } = useAccount();
    const valid = isAddress(param);
    const address = param as Address;
    const { data: p } = useAsync(() => (valid ? api.getProfile(address) : Promise.reject(new Error('invalid'))), [param]);
    const bal = useForgeBalance(valid ? address : undefined);
    const faucet = useFaucet();
    const [tab, setTab] = useState<Tab>('created');
    const isMe = me?.toLowerCase() === param.toLowerCase();

    if (!valid) return <div className="empty error">“{param}” is not a valid address.</div>;
    if (!p) return <div className="empty">Loading profile…</div>;

    return (
        <div className="stack" style={{ gap: 18 }}>
            <div className="panel row between wrap">
                <div className="row">
                    <Avatar color="#7c5cff" size={56} />
                    <div>
                        <h1 className="mono" style={{ fontSize: 24 }}>
                            {shortAddr(address)}
                        </h1>
                        <span className="muted mono" style={{ fontSize: 12 }}>
                            {address}
                        </span>
                    </div>
                    {isMe && <span className="badge">You</span>}
                </div>
                <div className="row wrap">
                    <div className="forge-pill">
                        <span className="coin" /> {bal.enabled ? (bal.formatted ?? '…') : Number(p.forgeBalance).toLocaleString()} FORGE
                    </div>
                    {isMe && (
                        <button className="btn gold" disabled={!faucet.canClaim || faucet.phase === 'signing' || faucet.phase === 'pending'} onClick={() => void faucet.claim()} title="ForgeCoin.claimFaucet() — 100 FORGE once per address">
                            {faucet.claimed ? 'Faucet claimed' : faucet.phase === 'pending' ? 'Claiming…' : 'Claim 100 FORGE'}
                        </button>
                    )}
                </div>
            </div>

            <div className="stats panel" style={{ padding: 0, gridTemplateColumns: 'repeat(4, 1fr)' }}>
                <div>
                    <span className="muted">Levels created</span>
                    <b>{p.created.length}</b>
                </div>
                <div>
                    <span className="muted">Levels owned</span>
                    <b>{p.owned.length}</b>
                </div>
                <div>
                    <span className="muted">Clears</span>
                    <b>{p.clears}</b>
                </div>
                <div>
                    <span className="muted">Best rank</span>
                    <b>{p.bestRank ? `#${p.bestRank}` : '—'}</b>
                </div>
            </div>

            <div className="tabs">
                {(['created', 'owned', 'clears'] as Tab[]).map((t) => (
                    <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                        {t === 'created' ? 'Created' : t === 'owned' ? 'Owned' : 'Recent clears'}
                    </button>
                ))}
            </div>

            {tab !== 'clears' && <div className="grid-cards">{(tab === 'created' ? p.created : p.owned).map((l) => <LevelCard key={l.id} level={l} />)}</div>}
            {tab === 'clears' && (
                <div className="panel">
                    <table className="table">
                        <thead>
                            <tr>
                                <th>Level</th>
                                <th>Time</th>
                                <th>Reward</th>
                                <th>When</th>
                            </tr>
                        </thead>
                        <tbody>
                            {p.recentClears.map((c) => (
                                <tr key={c.level.id}>
                                    <td>
                                        #{c.level.id} {c.level.name}
                                    </td>
                                    <td className="mono">{formatMs(c.timeMs)}</td>
                                    <td className="gold">+{c.reward} FORGE</td>
                                    <td className="muted">{c.ago}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
