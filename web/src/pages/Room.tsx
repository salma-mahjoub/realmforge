import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import { api } from '../api/client';
import { RaceConnection } from '../api/colyseus';
import type { RoomPlayer } from '../api/types';
import { PhaserGame } from '../game/PhaserGame';
import { EventBus, type HudState } from '../game/EventBus';
import { SCENES } from '../game/constants';
import { Avatar, formatMs, hex, shortAddr } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { MOCK_LEVELS, MOCK_ROOM_PLAYERS } from '../data/mock';

const PAYOUT = [
    ['1st', 60],
    ['2nd', 25],
    ['Owner', 10],
    ['Pool', 5],
] as const;

function CreateRoom() {
    const navigate = useNavigate();
    const { address } = useAccount();
    const [levelId, setLevelId] = useState(MOCK_LEVELS[0].id);
    const [stake, setStake] = useState('20');
    const [code, setCode] = useState('');
    const [err, setErr] = useState<string | null>(null);
    const { data: levels } = useAsync(() => api.listLevels({ sort: 'popular' }), []);

    const create = async () => {
        setErr(null);
        if (!address) return setErr('Connect your wallet to create a room.');
        try {
            const conn = await RaceConnection.create('race', { address, levelId, stake });
            const c = conn.code;
            await conn.leave();
            navigate(`/room/${c}`);
        } catch (e) {
            setErr(`Game server unreachable (${e instanceof Error ? e.message : String(e)}). Opening a local demo room.`);
            setTimeout(() => navigate('/room/K7Q2'), 1200);
        }
    };

    return (
        <div className="stack" style={{ maxWidth: 720, margin: '0 auto', gap: 18 }}>
            <h1 style={{ fontSize: 30 }}>Versus race</h1>
            <p className="muted">2–4 players, same level, first to the flag wins the pot. Stakes are escrowed by ForgeCoin and paid out 60/25/10/5.</p>
            <div className="panel stack">
                <h3>Create a room</h3>
                <label className="field">
                    Level
                    <select className="input" value={levelId} onChange={(e) => setLevelId(Number(e.target.value))}>
                        {(levels ?? MOCK_LEVELS).map((l) => (
                            <option key={l.id} value={l.id}>
                                #{l.id} {l.name} — {l.theme}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="field">
                    Stake per player (FORGE)
                    <input className="input" type="number" min={0} value={stake} onChange={(e) => setStake(e.target.value)} />
                </label>
                <button className="btn primary" onClick={() => void create()}>
                    Create room
                </button>
                {err && <p className="error">{err}</p>}
            </div>
            <div className="panel stack">
                <h3>Join with a code</h3>
                <div className="row">
                    <input className="input mono" placeholder="K7Q2" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
                    <button className="btn" disabled={!code} onClick={() => navigate(`/room/${code}`)}>
                        Join
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function Room() {
    const code = useParams().code ?? '';
    if (code.toLowerCase() === 'new') return <CreateRoom />;
    return <RaceRoom code={code} />;
}

function RaceRoom({ code }: { code: string }) {
    const { address } = useAccount();
    const [players, setPlayers] = useState<RoomPlayer[]>(MOCK_ROOM_PLAYERS);
    const [hud, setHud] = useState<HudState>({ timeMs: 0, coins: 0, checkpoint: null });
    const [online, setOnline] = useState<'connecting' | 'live' | 'demo'>('connecting');
    const [ping] = useState(32);
    const conn = useRef<RaceConnection | null>(null);
    const level = MOCK_LEVELS.find((l) => l.theme === 'desert') ?? MOCK_LEVELS[0];
    const { data: file } = useAsync(() => api.getLevelFile(level.id), [level.id]);

    useEffect(() => EventBus.subscribe('play:hud', setHud), []);

    useEffect(() => {
        let cancelled = false;
        if (!address) {
            setOnline('demo');
            return;
        }
        RaceConnection.joinByCode(code, { address, levelId: level.id })
            .then((c) => {
                if (cancelled) return void c.leave();
                conn.current = c;
                c.attachToScene();
                setOnline('live');
            })
            .catch(() => !cancelled && setOnline('demo'));
        return () => {
            cancelled = true;
            void conn.current?.leave();
            conn.current = null;
        };
    }, [code, address, level.id]);

    useEffect(() => {
        if (address) setPlayers((ps) => ps.map((p) => (p.isYou ? { ...p, address } : p)));
    }, [address]);

    const stake = 20;
    const pot = stake * players.filter((p) => p.stakePaid).length;
    const ranking = [players[3], players[0], players[1], players[2]].filter(Boolean);

    return (
        <div className="stack" style={{ gap: 14 }}>
            <div className="row between">
                <div className="row">
                    <h1 style={{ fontSize: 28 }}>Versus race</h1>
                    <span className="badge live">
                        <span className="dot" /> {online === 'live' ? 'LIVE' : online === 'connecting' ? 'CONNECTING' : 'DEMO'}
                    </span>
                </div>
                <span className="row muted" style={{ fontSize: 13 }}>
                    <span className="dot" /> Ping {ping}ms
                </span>
            </div>

            <div className="race-layout">
                <div className="panel stack">
                    <div>
                        <h2 className="mono">Room #{code}</h2>
                        <span className="muted">
                            {players.length} / 4 players
                        </span>
                    </div>
                    {players.map((p) => (
                        <div key={p.sessionId} className="player-row">
                            <Avatar color={hex(p.color)} />
                            <div className="grow">
                                <div className="mono">{shortAddr(p.address)}</div>
                                <div className={p.stakePaid ? 'green' : 'muted'} style={{ fontSize: 13 }}>
                                    {p.stakePaid ? `Stake ${stake} FORGE paid` : 'Waiting for stake'}
                                </div>
                            </div>
                            {p.isYou && <span className="badge">You</span>}
                        </div>
                    ))}
                    <div className="row" style={{ fontSize: 22, fontWeight: 800 }}>
                        <span className="coin" style={{ width: 28, height: 28 }} /> Pot <span className="gold">{pot} FORGE</span>
                    </div>
                    <div className="panel" style={{ background: 'var(--bg-2)' }}>
                        <div className="muted" style={{ marginBottom: 6 }}>
                            Payout 60/25/10/5
                        </div>
                        {PAYOUT.map(([label, pct]) => (
                            <div key={label} className="row between" style={{ fontSize: 14 }}>
                                <span>{label}</span>
                                <span className="muted">{pct}%</span>
                                <b className="gold">{(pot * pct) / 100} FORGE</b>
                            </div>
                        ))}
                    </div>
                    <button className="btn primary" onClick={() => conn.current?.ready()} disabled={online !== 'live'}>
                        Ready
                    </button>
                </div>

                <div className="panel stack" style={{ padding: 12 }}>
                    <div className="row">
                        <h2>{level.name}</h2>
                        <span className="muted">Race in progress</span>
                    </div>
                    <div className="play-stage">
                        <div className="hud">
                            <div className="mono">⏱ {formatMs(hud.timeMs)}</div>
                        </div>
                        <div className="ranking">
                            <b>Live ranking</b>
                            {ranking.map((p, i) => (
                                <div key={p.sessionId}>
                                    <span style={{ width: 28 }}>{['1st', '2nd', '3rd', '4th'][i]}</span>
                                    <span className="pcolor" style={{ background: hex(p.color) }} />
                                    {p.isYou ? 'You' : shortAddr(p.address)}
                                </div>
                            ))}
                        </div>
                        {file ? <PhaserGame scene={SCENES.Race} data={{ level: file, levelId: String(level.id), roomCode: code }} /> : <div className="game-container" />}
                    </div>
                    <span className="muted" style={{ fontSize: 13 }}>
                        ⚑ First to the flag wins
                    </span>
                </div>
            </div>
        </div>
    );
}
