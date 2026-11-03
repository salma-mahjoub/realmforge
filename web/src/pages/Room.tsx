import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Copy, Flag, Hourglass, KeyRound, LogOut, Plus, Radio, RotateCcw, Swords, Users } from 'lucide-react';
import { api } from '../api/client';
import { RaceConnection, colorFor, stashConnection, takeConnection } from '../api/colyseus';
import type { RoomPlayer } from '../api/types';
import { EventBus } from '../game/EventBus';
import { PhaserGame } from '../game/PhaserGame';
import { SCENES } from '../game/constants';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, ForgeCoin, Input, LevelThumb, Pill, Select, Skeleton, TokenAmount, cx, hex, shortAddr, toast } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { useMockData } from '../api/dataSource';
import { MOCK_LEVELS, MOCK_ROOM_PLAYERS } from '../data/mock';
import { formatEther, parseEther } from 'viem';
import { RACE_STATUS, RACE_TIMEOUT_SEC, parseRaceResult, useForgeBalance, useRace, type SignedRaceResult } from '../contracts/hooks';
import { useServiceStatus, useTxFlow, useWeb3Status } from '../web3/tx';
import { BlockerNotice } from '../components/BlockerNotice';
import { humanizeError } from '../web3/errors';

/** ForgeCoin race payout (SPEC §5.1): winner / second / level owner / season pool. */
export const PAYOUT = [
    ['1st', 60],
    ['2nd', 25],
    ['Owner', 10],
    ['Pool', 5],
] as const;

function CreateRoom() {
    const navigate = useNavigate();
    const web3 = useWeb3Status();
    const svc = useServiceStatus();
    const bal = useForgeBalance();
    const race = useRace();
    const tx = useTxFlow();
    const { data: levels, loading } = useAsync(() => api.listLevels({ sort: 'popular' }), []);
    const [levelId, setLevelId] = useState<number>(MOCK_LEVELS[0].id);
    const [stake, setStake] = useState('20');
    const [code, setCode] = useState('');
    const [creating, setCreating] = useState(false);
    const list = levels ?? MOCK_LEVELS;
    const level = list.find((l) => l.id === levelId) ?? list[0];
    // The state starts on a demo level id (41); once the real list loads the <select> and the preview fall back
    // to its first entry, so what is sent on-chain must follow `level`, not the stale state (ERC721NonexistentToken(41)).
    const selectedId = level?.id ?? levelId; // `level` is undefined while no level is published
    const stakeN = Number(stake);
    const balance = bal.value !== undefined ? Number(bal.value / 10n ** 18n) : undefined;
    const stakeError = !stake || !Number.isFinite(stakeN) || stakeN <= 0 ? 'Enter a stake above 0' : balance !== undefined && stakeN > balance ? `You only have ${balance} FORGE` : null;

    const create = async () => {
        if (!web3.address) return;
        setCreating(true);
        try {
            const conn = await RaceConnection.create('race', { address: web3.address, levelId: selectedId, stake });
            const c = conn.code;
            // Escrow the creator's stake on-chain (ForgeCoin.createRaceRoom); the room code is the on-chain id.
            const out = await tx.run('create-race', { title: `Escrow ${stake} FORGE`, success: 'Race created', successBody: 'Your stake is in escrow. Share the room code.' }, () => race.createRoom(c, BigInt(selectedId), parseEther(stake)));
            if (!out.ok) return void (await conn.leave());
            stashConnection(conn); // keep the room alive while the lobby page opens
            navigate(`/room/${c}`);
        } catch (e) {
            toast.show({ tone: 'warning', title: 'Game server unreachable', body: `${humanizeError(e)} Opening a demo lobby instead.` });
            navigate('/room/DEMO');
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="page page-room-new">
            <header className="page-head">
                <div>
                    <h1 className="page-title">Versus race</h1>
                    <p className="page-sub">2–4 players race the same level. Stakes are escrowed by ForgeCoin; first to the flag takes 60% of the pot.</p>
                </div>
                {svc.api === 'offline' && <Pill tone="amber">Game server offline · demo lobby only</Pill>}
            </header>
            <div className="room-new-grid">
                <Card>
                    <CardHeader icon={<Plus size={18} />} title="Create a room" />
                    <div className="form-stack">
                        <Field label="Level" htmlFor="room-level">
                            <Select id="room-level" value={selectedId} onChange={(e) => setLevelId(Number(e.target.value))} disabled={loading && !levels}>
                                {list.map((l) => (
                                    <option key={l.id} value={l.id}>
                                        #{l.id} {l.name} · {l.theme}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        {level && (
                            <div className="room-level-preview">
                                <LevelThumb level={level} />
                                <div>
                                    <b>{level.name}</b>
                                    <span className="fine">
                                        {Math.round(level.clearRate * 100)}% clear rate · best {level.bestTimeMs ? `${(level.bestTimeMs / 1000).toFixed(1)}s` : '—'}
                                    </span>
                                </div>
                            </div>
                        )}
                        <Field label="Stake per player" htmlFor="room-stake" error={stakeError} hint={balance !== undefined ? `Balance: ${balance} FORGE` : 'Escrowed on-chain by ForgeCoin.joinRace when the race starts.'}>
                            <Input id="room-stake" inputMode="numeric" value={stake} onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ''))} suffix="FORGE" />
                        </Field>
                        <dl className="payout-mini" aria-label="Payout for a full room">
                            {PAYOUT.map(([label, pct]) => (
                                <div key={label}>
                                    <dt>{label}</dt>
                                    <dd>
                                        {pct}% · <b>{Number.isFinite(stakeN) ? ((stakeN * 4 * pct) / 100).toLocaleString() : '—'}</b>
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        <BlockerNotice compact />
                        <Button variant="primary" size="lg" icon={<Swords size={18} aria-hidden />} loading={creating} disabled={!web3.address || !!stakeError || !level} onClick={() => void create()}>
                            Create room
                        </Button>
                    </div>
                </Card>
                <Card>
                    <CardHeader icon={<KeyRound size={18} />} title="Join with a code" />
                    <form
                        className="join-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (code) navigate(`/room/${code}`);
                        }}
                    >
                        <Input aria-label="Room code" placeholder="K7Q2" value={code} maxLength={12} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} className="code-input" />
                        <Button type="submit" disabled={!code}>
                            Join
                        </Button>
                    </form>
                    <p className="fine">Ask the host for the 4-character code shown in their lobby.</p>
                    <div className="divider" />
                    <h3 className="mini-title">How a race settles</h3>
                    <ol className="plain-steps">
                        <li>Everyone pays the stake into ForgeCoin escrow (createRaceRoom / joinRace).</li>
                        <li>The Colyseus room times the race server-side and checks plausibility.</li>
                        <li>The server signs the ranking (EIP-712 RaceResult) and anyone can submit it to pay out.</li>
                    </ol>
                    <Button variant="ghost" onClick={() => navigate('/room/DEMO')}>
                        Try the demo lobby
                    </Button>
                </Card>
            </div>
        </div>
    );
}

export default function Room() {
    const code = useParams().code ?? '';
    if (code.toLowerCase() === 'new') return <CreateRoom />;
    return <RaceRoom code={code.toUpperCase()} />;
}

type Online = 'connecting' | 'live' | 'demo';

function RaceRoom({ code }: { code: string }) {
    const web3 = useWeb3Status();
    const [demoPlayers, setPlayers] = useState<RoomPlayer[]>(MOCK_ROOM_PLAYERS.map((p) => (p.isYou ? { ...p, ready: false } : p)));
    const [livePlayers, setLivePlayers] = useState<RoomPlayer[] | null>(null);
    const [liveLevelId, setLiveLevelId] = useState<number | null>(null);
    const [result, setResult] = useState<SignedRaceResult | null>(null);
    const [online, setOnline] = useState<Online>('connecting');
    const [countdown, setCountdown] = useState<number | null>(null);
    const [started, setStarted] = useState(false);
    const [copied, setCopied] = useState(false);
    const [fell, setFell] = useState(false);
    const [myRace, setMyRace] = useState<{ finished: boolean; gaveUp: boolean }>({ finished: false, gaveUp: false });
    const conn = useRef<RaceConnection | null>(null);
    const demoLevel = MOCK_LEVELS.find((l) => l.theme === 'desert') ?? MOCK_LEVELS[0];
    // live room: the level the creator picked (room state), otherwise the sample level of the demo lobby
    const level = liveLevelId !== null ? { ...demoLevel, id: liveLevelId, name: `Level #${liveLevelId}` } : demoLevel;
    const file = useAsync(() => api.getLevelFile(level.id), [level.id]);
    const race = useRace(online === 'live' ? code : undefined);
    const tx = useTxFlow();
    // on-chain stake status decides who has really paid, whatever the lobby says
    const staked = new Set((race.race?.players ?? []).map((a) => a.toLowerCase()));
    const players = online === 'live' && livePlayers ? livePlayers.map((p) => ({ ...p, stakePaid: staked.has(p.address.toLowerCase()) })) : demoPlayers;
    const mockFile = useMockData('/levels/1/file');
    // The game reads its level once, at mount. In a live room the real level id only arrives with the room state,
    // so wait for it (and for that level's file) instead of mounting on the demo level and keeping it.
    const levelReady = online !== 'connecting' && (online !== 'live' || liveLevelId !== null) && !file.loading;

    useEffect(() => {
        let cancelled = false;
        if (!web3.address || code === 'DEMO') {
            setOnline('demo');
            return;
        }
        setOnline('connecting');
        const handedOver = takeConnection(code);
        (handedOver ? Promise.resolve(handedOver) : RaceConnection.joinByCode(code, { address: web3.address, levelId: demoLevel.id }))
            .then((c) => {
                if (cancelled) return void c.leave();
                conn.current = c;
                c.attachToScene();
                c.room.onMessage('result', (m: unknown) => setResult(parseRaceResult(m)));
                c.room.onStateChange((st) => {
                    const lid = Number(st.levelId);
                    if (Number.isFinite(lid) && st.levelId) setLiveLevelId(lid);
                    const list: RoomPlayer[] = [];
                    st.players?.forEach((p, sessionId) => {
                        if (sessionId === c.room.sessionId) setMyRace({ finished: Boolean((p as { finished?: boolean }).finished), gaveUp: Boolean((p as { gaveUp?: boolean }).gaveUp) });
                        list.push({
                            sessionId,
                            address: (p.address ?? '0x') as RoomPlayer['address'],
                            color: colorFor(sessionId),
                            stakePaid: false,
                            ready: Boolean((p as { ready?: boolean }).ready),
                            isYou: sessionId === c.room.sessionId,
                            finishedMs: (p as { finishTimeMs?: number }).finishTimeMs || undefined,
                        });
                    });
                    setLivePlayers(list);
                });
                c.room.onMessage('countdown', (m: unknown) => setCountdown(typeof m === 'number' ? m : Number((m as { seconds?: number })?.seconds ?? 3)));
                c.room.onMessage('start', () => {
                    setCountdown(0);
                    setStarted(true);
                });
                setOnline('live');
            })
            .catch(() => !cancelled && setOnline('demo'));
        return () => {
            cancelled = true;
            void conn.current?.leave();
            conn.current = null;
        };
    }, [code, web3.address, demoLevel.id]);

    // Falling ends the attempt, not the race: offer a respawn (R) or leaving the race.
    useEffect(() => {
        const offDied = EventBus.subscribe('play:died', () => setFell(true));
        const offState = EventBus.subscribe('play:state', (s) => s.state === 'playing' && setFell(false));
        return () => {
            offDied();
            offState();
        };
    }, []);

    useEffect(() => {
        if (web3.address) setPlayers((ps) => ps.map((p) => (p.isYou ? { ...p, address: web3.address! } : p)));
    }, [web3.address]);

    // Demo lobby: once everyone is ready, run a local 3-2-1 countdown (the live room gets it from the server).
    useEffect(() => {
        if (online !== 'demo' || started || countdown !== null) return;
        if (players.every((p) => p.ready)) setCountdown(3);
    }, [players, online, started, countdown]);
    useEffect(() => {
        if (countdown === null || online !== 'demo') return;
        if (countdown <= 0) {
            const t = setTimeout(() => {
                setStarted(true);
                setCountdown(null);
            }, 700);
            return () => clearTimeout(t);
        }
        const t = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 900);
        return () => clearTimeout(t);
    }, [countdown, online]);
    useEffect(() => {
        if (online !== 'demo') return;
        // the one sample player who is not ready yet gets ready a moment after you do
        const me = players.find((p) => p.isYou);
        if (!me?.ready) return;
        const t = setTimeout(() => setPlayers((ps) => ps.map((p) => ({ ...p, ready: true }))), 1200);
        return () => clearTimeout(t);
    }, [players, online]);

    const me = players.find((p) => p.isYou);
    const live = online === 'live';
    const raceStatus = race.race?.status;
    const createdAt = race.race ? Number(race.race.createdAt) : 0;
    const canRefund = live && raceStatus === RACE_STATUS.open && Date.now() / 1000 > createdAt + RACE_TIMEOUT_SEC;
    const needsStake = live && raceStatus === RACE_STATUS.open && !!web3.address && !staked.has(web3.address.toLowerCase());
    const joinStake = async () => {
        await tx.run('join-race', { title: `Escrow ${stake} FORGE`, success: 'You are in the race', successBody: 'Your stake is in escrow. Press ready when you are.' }, () => race.join(code));
        void race.refetch();
    };
    const settleRace = async () => {
        if (!result) return;
        await tx.run('settle-race', { title: 'Settle race', success: 'Race paid out', successBody: '1st gets 60%, 2nd 25%, the level owner 10%, the season pool 5%.' }, () => race.settle(result));
        void race.refetch();
    };
    const refundRace = async () => {
        await tx.run('refund-race', { title: 'Refund stakes', success: 'Stakes refunded', successBody: 'Every player got their stake back.' }, () => race.refund(code));
        void race.refetch();
    };
    const respawn = () => {
        setFell(false);
        EventBus.emit('play:restart');
    };
    const giveUp = () => {
        conn.current?.giveUp();
        setMyRace((r) => ({ ...r, gaveUp: true }));
    };
    const racing = live && started && !result && !myRace.finished && !myRace.gaveUp;
    const toggleReady = () => {
        if (online === 'live') conn.current?.ready();
        setPlayers((ps) => ps.map((p) => (p.isYou ? { ...p, ready: !p.ready } : p)));
    };
    const copyCode = async () => {
        try {
            await navigator.clipboard.writeText(`${location.origin}/room/${code}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Could not copy the invite link');
        }
    };

    const stake = race.race && race.race.stake > 0n ? Number(formatEther(race.race.stake)) : 20;
    const pot = stake * players.filter((p) => p.stakePaid).length;
    const readyCount = players.filter((p) => p.ready).length;
    const ranking = started ? [players[3], players[0], players[1], players[2]].filter(Boolean) : players;

    return (
        <div className="page page-race">
            <header className="race-head">
                <div className="row">
                    <h1 className="page-title">Versus race</h1>
                    {online === 'live' ? (
                        <Pill tone="green" pulse>
                            LIVE
                        </Pill>
                    ) : online === 'connecting' ? (
                        <Pill tone="amber" pulse>
                            Connecting
                        </Pill>
                    ) : (
                        <Pill tone="neutral">Demo lobby</Pill>
                    )}
                </div>
                <span className="race-ping">
                    <Radio size={14} aria-hidden /> {online === 'live' ? 'Ping 32ms' : online === 'demo' ? 'Offline: sample players, moves are not synced' : 'Reaching the game server…'}
                </span>
            </header>

            <div className="race-layout">
                <Card className="lobby">
                    <div className="lobby-head">
                        <div>
                            <h2 className="lobby-code">Room #{code}</h2>
                            <span className="fine">
                                <Users size={13} aria-hidden /> {players.length} / 4 players · {readyCount} ready
                            </span>
                        </div>
                        <Button size="sm" variant="ghost" icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} onClick={() => void copyCode()} aria-label="Copy invite link">
                            {copied ? 'Copied' : 'Invite'}
                        </Button>
                    </div>
                    <ul className="player-list" aria-label="Players">
                        {players.map((p) => (
                            <li key={p.sessionId} className={cx('player-row', p.isYou && 'is-you')}>
                                <Avatar color={hex(p.color)} size={38} />
                                <div className="player-text">
                                    <span className="player-addr" title={p.address}>
                                        {shortAddr(p.address)} {p.isYou && <Badge tone="violet">You</Badge>}
                                    </span>
                                    <span className={p.stakePaid ? 'player-stake ok' : 'player-stake'}>{p.stakePaid ? `Stake ${stake} FORGE paid` : 'Waiting for stake'}</span>
                                </div>
                                <Pill tone={p.ready ? 'green' : 'neutral'}>{p.ready ? 'Ready' : 'Not ready'}</Pill>
                            </li>
                        ))}
                        {Array.from({ length: Math.max(0, 4 - players.length) }, (_, i) => (
                            <li key={`empty-${i}`} className="player-row is-empty">
                                <Hourglass size={18} aria-hidden /> Waiting for a player…
                            </li>
                        ))}
                    </ul>
                    <div className="pot">
                        <ForgeCoin size={30} />
                        <span>
                            Pot <b className="gold">{pot} FORGE</b>
                        </span>
                    </div>
                    <dl className="payout">
                        <div className="payout-head">
                            <dt>Payout</dt>
                            <dd>60/25/10/5</dd>
                        </div>
                        {PAYOUT.map(([label, pct]) => (
                            <div key={label}>
                                <dt>{label}</dt>
                                <dd>
                                    <span className="fine">{pct}%</span> <TokenAmount value={(pot * pct) / 100} size="sm" />
                                </dd>
                            </div>
                        ))}
                    </dl>
                    {online === 'live' && web3.blocker && <BlockerNotice compact />}
                    {needsStake && (
                        <Button variant="primary" size="lg" block loading={tx.isBusy('join-race')} onClick={() => void joinStake()} icon={<ForgeCoin size={18} />}>
                            Join and escrow {stake} FORGE
                        </Button>
                    )}
                    {result && (
                        <div className="notice notice-info" role="status">
                            <Flag size={16} aria-hidden />
                            <span>
                                Race finished. 1st {shortAddr(result.ranking[0])}, 2nd {shortAddr(result.ranking[1])} (players who did not finish are ranked by progress). The server signed the ranking: anyone can submit it.
                            </span>
                            <Button size="sm" variant="primary" disabled={raceStatus !== RACE_STATUS.open} loading={tx.isBusy('settle-race')} onClick={() => void settleRace()}>
                                {raceStatus === RACE_STATUS.settled ? 'Paid out' : 'Settle on-chain'}
                            </Button>
                        </div>
                    )}
                    {canRefund && (
                        <Button variant="ghost" block loading={tx.isBusy('refund-race')} onClick={() => void refundRace()}>
                            Refund all stakes (race expired)
                        </Button>
                    )}
                    <Button variant={me?.ready ? 'secondary' : 'primary'} size="lg" block onClick={toggleReady} disabled={started || countdown !== null || (live && !me?.stakePaid)} icon={me?.ready ? <Check size={18} aria-hidden /> : undefined}>
                        {started ? 'Race in progress' : countdown !== null ? 'Starting…' : me?.ready ? 'Ready — waiting for others' : 'I’m ready'}
                    </Button>
                </Card>

                <Card className="race-stage-card" pad={false}>
                    <div className="race-stage-head">
                        <h2 className="card-title">{level.name}</h2>
                        <span className="fine">{started ? 'Race in progress' : 'Lobby: warm up while players get ready'}</span>
                        {racing && (
                            <div className="race-actions">
                                {fell && (
                                    <Button size="sm" variant="primary" icon={<RotateCcw size={14} aria-hidden />} onClick={respawn}>
                                        Respawn (R)
                                    </Button>
                                )}
                                <Button size="sm" variant="secondary" icon={<LogOut size={14} aria-hidden />} onClick={giveUp}>
                                    Give up
                                </Button>
                            </div>
                        )}
                    </div>
                    <div className="play-stage race-stage">
                        {file.data && levelReady ? (
                            <PhaserGame key={level.id} scene={SCENES.Race} data={{ level: mockFile ? { ...file.data, meta: { ...file.data.meta, theme: level.theme, name: level.name } } : file.data, levelId: String(level.id), roomCode: code }} />
                        ) : (
                            <div className="stage-loading">
                                <Skeleton w="100%" h="100%" r={0} />
                            </div>
                        )}
                        <div className="ranking" aria-label={started ? 'Live ranking' : 'Players'}>
                            <b>{started ? 'Live ranking' : 'Players'}</b>
                            <ol>
                                {ranking.map((p, i) => (
                                    <li key={p.sessionId}>
                                        <span className="rank-n">{started ? ['1st', '2nd', '3rd', '4th'][i] : ''}</span>
                                        <span className="pcolor" style={{ background: hex(p.color) }} aria-hidden />
                                        {p.isYou ? 'You' : shortAddr(p.address, 4, 3)}
                                    </li>
                                ))}
                            </ol>
                        </div>
                        {countdown !== null && (
                            <div className="countdown" role="status" aria-live="assertive">
                                <span key={countdown} className="countdown-n">
                                    {countdown > 0 ? countdown : 'GO!'}
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="race-foot">
                        <Flag size={15} aria-hidden /> {myRace.gaveUp ? 'You left the race: it ends when the others finish or leave' : 'First to the flag wins'}
                    </div>
                </Card>
            </div>
            {online === 'demo' && code !== 'DEMO' && !web3.address && (
                <EmptyState compact title="Connect a wallet to join this room for real">
                    You are seeing a demo lobby. Rooms need a wallet address to join and stake.
                </EmptyState>
            )}
        </div>
    );
}
