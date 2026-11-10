import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Copy, Flag, Hourglass, KeyRound, LogOut, Plus, Radio, RotateCcw, Swords, Users } from 'lucide-react';
import { api } from '../api/client';
import { RaceConnection, closeRoom, colorFor, describeJoinError, needsSignIn, openRoom, stashConnection } from '../api/colyseus';
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
import { liveRanking, secondsUntil } from './room/ranking';
import { BlockerNotice } from '../components/BlockerNotice';
import { humanizeError } from '../web3/errors';
import { useSiwe } from '../web3/siwe';

/** ForgeCoin race payout (SPEC §5.1): winner / second / level owner / season pool. */
export const PAYOUT = [
    ['1st', 60],
    ['2nd', 25],
    ['Owner', 10],
    ['Pool', 5],
] as const;
const PAYOUT_LABELS: Record<string, string> = { '1st': '1st place', '2nd': '2nd place', Owner: 'Level owner', Pool: 'Season pool' };
const fmt = (n: number) => (Number.isFinite(n) ? Number(n.toFixed(2)).toLocaleString() : '—');

function CreateRoom() {
    const navigate = useNavigate();
    const web3 = useWeb3Status();
    const svc = useServiceStatus();
    const bal = useForgeBalance();
    const race = useRace();
    const tx = useTxFlow();
    const siwe = useSiwe();
    const { data: levels, loading } = useAsync(() => api.listLevels({ sort: 'popular' }), []);
    const [levelId, setLevelId] = useState<number>(MOCK_LEVELS[0].id);
    const [stake, setStake] = useState('20');
    const [code, setCode] = useState('');
    const [creating, setCreating] = useState(false);
    const [players, setPlayers] = useState(2);
    // what the entered code points to on-chain: the host's stake is shown before anyone pays it
    const target = useRace(code.length >= 4 ? code : undefined);
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
            const conn = await RaceConnection.create('race', { address: web3.address, levelId: selectedId, stake }, siwe.provider);
            const c = conn.code;
            // Escrow the creator's stake on-chain (ForgeCoin.createRaceRoom); the room code is the on-chain id.
            const out = await tx.run('create-race', { title: `Escrow ${stake} FORGE`, success: 'Race created', successBody: 'Your stake is in escrow. Share the room code.' }, () => race.createRoom(c, BigInt(selectedId), parseEther(stake)));
            if (!out.ok) return void (await conn.leave());
            stashConnection(conn); // keep the room alive while the lobby page opens
            navigate(`/room/${c}`);
        } catch (e) {
            if (needsSignIn(e)) return void toast.show({ tone: 'error', title: 'Sign-in needed to create a room', body: describeJoinError(e) });
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
                    <p className="page-sub">Race the same level against 1 to 3 other players. Everyone pays the same stake into escrow and the fastest takes most of the pot.</p>
                </div>
                {svc.api === 'offline' && <Pill tone="amber">Game server offline · demo lobby only</Pill>}
            </header>
            <ol className="step-strip" aria-label="How it works">
                <li><b>1</b><span>Choose the level and the stake</span></li>
                <li><b>2</b><span>Confirm the stake in your wallet</span></li>
                <li><b>3</b><span>Share the room code</span></li>
                <li><b>4</b><span>Everyone presses ready and races</span></li>
            </ol>
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
                        <Field label="Stake per player" htmlFor="room-stake" error={stakeError} hint={`You set the stake for the whole room: every player pays this same amount. ForgeCoin holds it until the race is paid out, or refunds it after 1 hour.${balance !== undefined ? ` Your balance: ${balance} FORGE.` : ''}`}>
                            <Input id="room-stake" inputMode="numeric" value={stake} onChange={(e) => setStake(e.target.value.replace(/[^\d.]/g, ''))} suffix="FORGE" />
                        </Field>
                        <div className="players-toggle" role="group" aria-label="Number of players">
                            <span className="fine">If</span>
                            {[2, 3, 4].map((n) => (
                                <button key={n} type="button" aria-pressed={players === n} className={cx('seg', players === n && 'seg-on')} onClick={() => setPlayers(n)}>
                                    {n}
                                </button>
                            ))}
                            <span className="fine">
                                players race, the pot is <b className="gold">{fmt(stakeN * players)} FORGE</b> and is paid out like this:
                            </span>
                        </div>
                        <dl className="payout-mini" aria-label={`Payout for ${players} players`}>
                            {PAYOUT.map(([label, pct]) => (
                                <div key={label}>
                                    <dt>{PAYOUT_LABELS[label]}</dt>
                                    <dd>
                                        {pct}% · <b>{fmt((stakeN * players * pct) / 100)}</b>
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        <BlockerNotice compact />
                        <Button variant="primary" size="lg" icon={<Swords size={18} aria-hidden />} loading={creating} disabled={!web3.address || !!stakeError || !level} onClick={() => void create()}>
                            Create room and stake {fmt(stakeN)} FORGE
                        </Button>
                        <p className="fine">
                            {siwe.signedIn ? 'One wallet confirmation.' : 'First one free sign-in signature (no gas) proving this wallet is yours, then one wallet confirmation for the stake.'} Then you get the room code to share with the other players.
                        </p>
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
                            Open room
                        </Button>
                    </form>
                    <JoinInfo code={code} race={target.race} />
                    <div className="divider" />
                    <h3 className="mini-title">How a race works</h3>
                    <ol className="plain-steps">
                        <li>The host picks the level and the stake. Joining players pay that same stake.</li>
                        <li>Stakes sit in ForgeCoin escrow. The game server times the race and checks that nobody cheats.</li>
                        <li>When it ends, the server signs the ranking and anyone can submit it to pay out. Players who did not finish are ranked by progress.</li>
                        <li>If a race is never paid out, every stake can be refunded after 1 hour.</li>
                    </ol>
                    <Button variant="ghost" onClick={() => navigate('/room/DEMO')}>
                        Try the demo lobby
                    </Button>
                </Card>
            </div>
        </div>
    );
}

type RaceView = ReturnType<typeof useRace>['race'];

/** What the typed code points to on-chain, so a joining player sees the host's stake before paying it. */
function JoinInfo({ code, race }: { code: string; race: RaceView }) {
    if (code.length < 4) {
        return <p className="fine">Ask the host for the room code. The host chooses the stake: you will see it here before you pay anything.</p>;
    }
    if (!race) return <p className="fine join-info">Looking for this room…</p>;
    if (race.status === RACE_STATUS.none) {
        return <p className="fine join-info join-info-warn">No race with this code on this network yet. Check the code, or wait until the host has confirmed the stake.</p>;
    }
    const stake = formatEther(race.stake);
    if (race.status !== RACE_STATUS.open) {
        return <p className="fine join-info join-info-warn">This race is already over ({race.status === RACE_STATUS.settled ? 'paid out' : 'refunded'}).</p>;
    }
    return (
        <p className="join-info join-info-ok">
            <b>Stake {stake} FORGE</b> · {race.players.length} / 4 players · level #{race.levelId.toString()}
            <span className="fine">Open the room, then confirm {stake} FORGE once to take your seat. The host fixed this amount.</span>
        </p>
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
    const [joinError, setJoinError] = useState<string | null>(null);
    /** The join failed for lack of a wallet signature: offer to sign in and retry instead of the demo lobby. */
    const [joinNeedsSignIn, setJoinNeedsSignIn] = useState(false);
    const [joinAttempt, setJoinAttempt] = useState(0);
    const siwe = useSiwe();
    const siweProvider = useRef(siwe.provider);
    siweProvider.current = siwe.provider;
    const [countdown, setCountdown] = useState<number | null>(null);
    const [startAt, setStartAt] = useState<number | null>(null);
    const [started, setStarted] = useState(false);
    const [copied, setCopied] = useState<'code' | 'link' | null>(null);
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
        setJoinError(null);
        setJoinNeedsSignIn(false);
        const key = `${code}:${web3.address}`;
        openRoom(key, code, () => RaceConnection.joinByCode(code, { address: web3.address!, levelId: demoLevel.id }, siweProvider.current))
            .then((c) => {
                if (cancelled) return;
                conn.current = c;
                const applyState = (st: NonNullable<typeof c.room.state>) => {
                    const lid = Number(st.levelId);
                    if (Number.isFinite(lid) && st.levelId) setLiveLevelId(lid);
                    const list: RoomPlayer[] = [];
                    let slot = 0;
                    st.players?.forEach((p, sessionId) => {
                        const mySlot = slot++;
                        if (sessionId === c.room.sessionId) setMyRace({ finished: Boolean((p as { finished?: boolean }).finished), gaveUp: Boolean((p as { gaveUp?: boolean }).gaveUp) });
                        list.push({
                            sessionId,
                            address: (p.address ?? '0x') as RoomPlayer['address'],
                            color: colorFor(mySlot),
                            stakePaid: false,
                            ready: Boolean((p as { ready?: boolean }).ready),
                            isYou: sessionId === c.room.sessionId,
                            finishedMs: (p as { finishTimeMs?: number }).finishTimeMs || undefined,
                            progress: (p as { x?: number }).x ?? 0,
                        });
                    });
                    setLivePlayers(list);
                };
                // listeners go on once per connection; the state is also applied now, as its first sync may already be past
                if (!c.bound) {
                    c.bound = true;
                    c.attachToScene();
                    c.room.onMessage('result', (m: unknown) => {
                        const r = parseRaceResult(m);
                        setResult(r);
                        if (r) EventBus.emit('race:ended', r.ranking.findIndex((a) => a.toLowerCase() === web3.address?.toLowerCase()) + 1);
                    });
                    c.room.onStateChange(applyState);
                    // The server sends the start time; tick the 3-2-1 locally towards it.
                    c.room.onMessage('countdown', (m: unknown) => setStartAt(Number((m as { startAt?: number })?.startAt) || Date.now() + 3000));
                    c.room.onMessage('start', () => {
                        EventBus.emit('race:start');
                        setStartAt(null);
                        setCountdown(0); // "GO!", cleared by the effect below
                        setStarted(true);
                    });
                }
                if (c.room.state) applyState(c.room.state);
                setOnline('live');
            })
            .catch((e) => {
                if (cancelled) return;
                setJoinError(describeJoinError(e));
                setJoinNeedsSignIn(needsSignIn(e));
                setOnline('demo');
            });
        return () => {
            cancelled = true;
            conn.current = null;
            closeRoom(key);
        };
    }, [code, web3.address, demoLevel.id, joinAttempt]);

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

    // Live room: show 3-2-1 towards the server's start time, then "GO!" for a moment.
    useEffect(() => {
        if (startAt === null) return;
        const tick = () => setCountdown(Math.max(1, secondsUntil(startAt, Date.now())));
        tick();
        const t = setInterval(tick, 200);
        return () => clearInterval(t);
    }, [startAt]);
    useEffect(() => {
        if (online !== 'live' || countdown !== 0) return;
        const t = setTimeout(() => setCountdown(null), 900);
        return () => clearTimeout(t);
    }, [countdown, online]);

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
    const copyText = async (text: string, what: 'code' | 'link') => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(what);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            toast.error('Could not copy to the clipboard');
        }
    };

    const stake = race.race && race.race.stake > 0n ? Number(formatEther(race.race.stake)) : 20;
    const pot = stake * players.filter((p) => p.stakePaid).length;
    const readyCount = players.filter((p) => p.ready).length;
    // The demo lobby keeps its scripted order; a live room shows the real one.
    const ranking = !started ? players : online === 'live' ? liveRanking(players, result?.ranking) : [players[3], players[0], players[1], players[2]].filter(Boolean);
    const finishedRace = started && Boolean(result);

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
            {joinError && web3.address && joinNeedsSignIn && (
                <div className="notice notice-error" role="alert">
                    <span>
                        <b>Wallet signature required.</b> {joinError} What you see below is a demo lobby, not your race.
                    </span>
                    <Button size="sm" variant="primary" icon={<KeyRound size={14} aria-hidden />} onClick={() => setJoinAttempt((n) => n + 1)}>
                        Sign in and join
                    </Button>
                </div>
            )}

            <div className="race-layout">
                <Card className="lobby">
                    <div className="invite-card">
                        <span className="invite-label">{online === 'demo' ? 'Demo room: sample players, nobody can join it' : 'Room code: share it with the other players'}</span>
                        <div className="invite-code" aria-label={`Room code ${code.split('').join(' ')}`}>
                            {code}
                        </div>
                        <div className="invite-actions">
                            <Button size="sm" variant="secondary" icon={copied === 'code' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} onClick={() => void copyText(code, 'code')}>
                                {copied === 'code' ? 'Copied' : 'Copy code'}
                            </Button>
                            <Button size="sm" variant="ghost" icon={copied === 'link' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} onClick={() => void copyText(`${location.origin}/room/${code}`, 'link')}>
                                {copied === 'link' ? 'Copied' : 'Copy invite link'}
                            </Button>
                        </div>
                        <span className="fine">They open Race, type the code under “Join with a code”, then pay the same stake ({stake} FORGE).</span>
                    </div>
                    {!started && (
                        <ol className="lobby-steps" aria-label="Before the race">
                            <li className={cx(me?.stakePaid && 'is-done')}>Pay your stake ({stake} FORGE)</li>
                            <li className={cx(players.length >= 2 && 'is-done')}>Wait for at least one more player ({players.length} / 4 here)</li>
                            <li className={cx(me?.ready && 'is-done')}>Press “I’m ready”: the race starts when everyone is ready</li>
                        </ol>
                    )}
                    <span className="fine lobby-count">
                        <Users size={13} aria-hidden /> {players.length} / 4 players · {readyCount} ready
                    </span>
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
                        {!started && Array.from({ length: Math.max(0, 4 - players.length) }, (_, i) => (
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
                    {joinError && web3.address && !joinNeedsSignIn && (
                        <div className="notice notice-error" role="alert">
                            <span>Could not join the live room ({joinError}). What you see is a demo lobby with sample players and a sample level, not your race.</span>
                        </div>
                    )}
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
                        {finishedRace ? 'Race finished' : started ? 'Race in progress' : countdown !== null ? 'Starting…' : me?.ready ? 'Ready — waiting for others' : 'I’m ready'}
                    </Button>
                </Card>

                <Card className="race-stage-card" pad={false}>
                    <div className="race-stage-head">
                        <h2 className="card-title">{level.name}</h2>
                        <span className="fine">{finishedRace ? 'Race finished' : started ? 'Race in progress' : 'Lobby: warm up while players get ready'}</span>
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
                            <b>{finishedRace ? 'Final ranking' : started ? 'Live ranking' : 'Players'}</b>
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
