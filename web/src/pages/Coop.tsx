import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Copy, Flag, HandHeart, Hourglass, KeyRound, LogOut, MapPin, Plus, RotateCcw, Timer, Users } from 'lucide-react';
import type { Hex } from 'viem';
import { api } from '../api/client';
import { RaceConnection, closeRoom, colorFor, openRoom, stashConnection } from '../api/colyseus';
import { EventBus } from '../game/EventBus';
import { PhaserGame } from '../game/PhaserGame';
import { SCENES } from '../game/constants';
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Input, LevelThumb, Pill, Select, Skeleton, Stat, cx, formatMs, hex, shortAddr, toast } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { MOCK_LEVELS } from '../data/mock';
import { useSettleRun } from '../contracts/hooks';
import { useServiceStatus, useTxFlow, useWeb3Status } from '../web3/tx';
import { humanizeError, isUserRejection } from '../web3/errors';
import { BlockerNotice } from '../components/BlockerNotice';
import { secondsUntil } from './room/ranking';
import { parseCoopResult, teamSummary, type CoopResultMessage, type TeamMember } from './coop/team';
import './coop/coop.css';

/**
 * Co-op mode (SPEC §3.5), client for server/src/rooms/CoopRoom.ts: 2–4 players on the same level, no stake.
 * `/coop/new` creates a room (`coop`, minPlayers = maxPlayers = team size) or opens one by code; `/coop/:code` is
 * the lobby (ready-up, 3-2-1 towards the server's startAt), the CoopScene stage and the team result.
 */
export default function Coop() {
    const code = useParams().code ?? '';
    if (code.toLowerCase() === 'new') return <CreateCoop />;
    return <CoopLobby code={code.toUpperCase()} />;
}

function CreateCoop() {
    const navigate = useNavigate();
    const web3 = useWeb3Status();
    const svc = useServiceStatus();
    const { data: levels, loading } = useAsync(() => api.listLevels({ sort: 'popular' }), []);
    const [levelId, setLevelId] = useState<number>(MOCK_LEVELS[0].id);
    const [team, setTeam] = useState(2);
    const [code, setCode] = useState('');
    const [creating, setCreating] = useState(false);
    const list = levels ?? MOCK_LEVELS;
    const level = list.find((l) => l.id === levelId) ?? list[0];
    const selectedId = level?.id ?? levelId;

    const create = async () => {
        if (!web3.address) return;
        setCreating(true);
        try {
            const conn = await RaceConnection.create('coop', { address: web3.address, levelId: selectedId, minPlayers: team, maxPlayers: team });
            stashConnection(conn); // keep the room alive while the lobby page opens
            navigate(`/coop/${conn.code}`);
        } catch (e) {
            toast.show({ tone: 'warning', title: 'Could not create the co-op room', body: humanizeError(e) });
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="page page-room-new">
            <header className="page-head">
                <div>
                    <h1 className="page-title">Co-op</h1>
                    <p className="page-sub">Clear a level together with 1 to 3 friends. Checkpoints are shared: when anyone reaches one, the whole team respawns there. The team clears when everyone reaches the flag. No stake.</p>
                </div>
                {svc.api === 'offline' && <Pill tone="amber">Game server offline</Pill>}
            </header>
            <ol className="step-strip" aria-label="How it works">
                <li><b>1</b><span>Choose the level and the team size</span></li>
                <li><b>2</b><span>Share the room code</span></li>
                <li><b>3</b><span>Everyone presses ready</span></li>
                <li><b>4</b><span>Reach the flag together</span></li>
            </ol>
            <div className="room-new-grid">
                <Card>
                    <CardHeader icon={<Plus size={18} />} title="Create a co-op room" />
                    <div className="form-stack">
                        <Field label="Level" htmlFor="coop-level">
                            <Select id="coop-level" value={selectedId} onChange={(e) => setLevelId(Number(e.target.value))} disabled={loading && !levels}>
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
                        <div className="players-toggle" role="group" aria-label="Team size">
                            <span className="fine">Team of</span>
                            {[2, 3, 4].map((n) => (
                                <button key={n} type="button" aria-pressed={team === n} className={cx('seg', team === n && 'seg-on')} onClick={() => setTeam(n)}>
                                    {n}
                                </button>
                            ))}
                            <span className="fine">players. The run starts when the whole team is in and ready.</span>
                        </div>
                        <Button variant="primary" size="lg" icon={<HandHeart size={18} aria-hidden />} loading={creating} disabled={!web3.address || !level} onClick={() => void create()}>
                            Create co-op room
                        </Button>
                        <p className="fine">{web3.address ? 'No transaction: co-op rooms are free. Each player can claim their reward on-chain after a team clear.' : 'Connect a wallet first: rooms know players by address.'}</p>
                    </div>
                </Card>
                <Card>
                    <CardHeader icon={<KeyRound size={18} />} title="Join with a code" />
                    <form
                        className="join-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (code) navigate(`/coop/${code}`);
                        }}
                    >
                        <Input aria-label="Room code" placeholder="K7Q2" value={code} maxLength={12} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} className="code-input" />
                        <Button type="submit" disabled={!code}>
                            Join team
                        </Button>
                    </form>
                    <p className="fine">Ask a teammate for the 4-letter room code.</p>
                    <div className="divider" />
                    <h3 className="mini-title">How co-op works</h3>
                    <ol className="plain-steps">
                        <li>Everyone plays the same level at the same time and sees the others move live.</li>
                        <li>A checkpoint reached by anyone counts for the whole team: a fall respawns you at the furthest one.</li>
                        <li>The team clears when every player reaches the flag. The team time is when the last one arrives.</li>
                        <li>The game server times the run and signs each player’s result, which pays a reward like a solo clear.</li>
                    </ol>
                </Card>
            </div>
        </div>
    );
}

interface Teammate extends TeamMember {
    sessionId: string;
    color: number;
    ready: boolean;
    isYou: boolean;
    checkpoint: number;
}

type Online = 'connecting' | 'live' | 'error';

/** Fields of the CoopRoom state the lobby reads (server/src/rooms/state.ts). */
interface CoopStateView {
    phase?: string;
    levelId?: string;
    minPlayers?: number;
    checkpointCount?: number;
    sharedCheckpoint?: number;
    elapsedMs?: number;
    players?: { forEach(cb: (p: Record<string, unknown>, sessionId: string) => void): void };
}

function CoopLobby({ code }: { code: string }) {
    const web3 = useWeb3Status();
    const [online, setOnline] = useState<Online>('connecting');
    const [joinError, setJoinError] = useState<string | null>(null);
    const [team, setTeam] = useState<Teammate[]>([]);
    const [levelId, setLevelId] = useState<number | null>(null);
    const [room, setRoom] = useState({ minPlayers: 2, checkpointCount: 0, shared: -1, phase: 'waiting' });
    const [result, setResult] = useState<CoopResultMessage | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [startAt, setStartAt] = useState<number | null>(null);
    const [started, setStarted] = useState(false);
    const [copied, setCopied] = useState(false);
    const conn = useRef<RaceConnection | null>(null);
    const level = levelId !== null ? MOCK_LEVELS.find((l) => l.id === levelId) ?? { ...MOCK_LEVELS[0], id: levelId, name: `Level #${levelId}` } : null;
    const file = useAsync(() => (levelId !== null ? api.getLevelFile(levelId) : Promise.resolve(null)), [levelId]);
    const meta = useAsync(() => (levelId !== null ? api.getLevel(levelId).catch(() => null) : Promise.resolve(null)), [levelId]);
    const levelName = meta.data?.name ?? level?.name ?? 'Loading level…';

    useEffect(() => {
        if (!web3.address) return;
        let cancelled = false;
        setOnline('connecting');
        setJoinError(null);
        const key = `coop:${code}:${web3.address}`;
        openRoom(key, code, () => RaceConnection.joinByCode(code, { address: web3.address!, levelId: 0 }))
            .then((c) => {
                if (cancelled) return;
                conn.current = c;
                if (import.meta.env.DEV) (window as unknown as { __coopRoom?: unknown }).__coopRoom = c.room; // browser E2E reads strikes/frames
                const applyState = (st: CoopStateView) => {
                    const lid = Number(st.levelId);
                    if (st.levelId && Number.isFinite(lid)) setLevelId(lid);
                    const shared = Number(st.sharedCheckpoint ?? -1);
                    setRoom({ minPlayers: Number(st.minPlayers ?? 2), checkpointCount: Number(st.checkpointCount ?? 0), shared, phase: String(st.phase ?? 'waiting') });
                    EventBus.emit('coop:shared-checkpoint', shared);
                    const list: Teammate[] = [];
                    let slot = 0;
                    st.players?.forEach((p, sessionId) => {
                        list.push({
                            sessionId,
                            address: String(p.address ?? '0x'),
                            color: colorFor(slot++),
                            ready: Boolean(p.ready),
                            isYou: sessionId === c.room.sessionId,
                            finished: Boolean(p.finished),
                            finishTimeMs: Number(p.finishTimeMs ?? 0),
                            connected: p.connected !== false,
                            gaveUp: Boolean(p.gaveUp),
                            disqualified: Boolean(p.disqualified),
                            checkpoint: Number(p.checkpoint ?? -1),
                        });
                    });
                    setTeam(list);
                };
                if (!c.bound) {
                    c.bound = true;
                    c.attachToScene();
                    c.room.onStateChange((st) => applyState(st as CoopStateView));
                    c.room.onMessage('countdown', (m: unknown) => setStartAt(Number((m as { startAt?: number })?.startAt) || Date.now() + 3000));
                    c.room.onMessage('start', () => {
                        EventBus.emit('race:start');
                        setStartAt(null);
                        setCountdown(0);
                        setStarted(true);
                    });
                    c.room.onMessage('checkpoint', (m: unknown) => {
                        const index = Number((m as { index?: number })?.index);
                        if (Number.isFinite(index)) EventBus.emit('coop:shared-checkpoint', index);
                    });
                    c.room.onMessage('finished', () => undefined);
                    c.room.onMessage('result', (m: unknown) => {
                        const r = parseCoopResult(m);
                        setResult(r ?? { signed: null, cleared: false, error: 'unreadable result' });
                        EventBus.emit('coop:ended', Boolean(r?.cleared));
                    });
                }
                if (c.room.state) applyState(c.room.state as CoopStateView);
                setOnline('live');
            })
            .catch((e) => {
                if (cancelled) return;
                setJoinError(humanizeError(e));
                setOnline('error');
            });
        return () => {
            cancelled = true;
            conn.current = null;
            closeRoom(key);
        };
    }, [code, web3.address]);

    // 3-2-1 towards the server's start time, then "GO!" for a moment.
    useEffect(() => {
        if (startAt === null) return;
        const tick = () => setCountdown(Math.max(1, secondsUntil(startAt, Date.now())));
        tick();
        const t = setInterval(tick, 200);
        return () => clearInterval(t);
    }, [startAt]);
    useEffect(() => {
        if (countdown !== 0) return;
        const t = setTimeout(() => setCountdown(null), 900);
        return () => clearTimeout(t);
    }, [countdown]);

    const me = team.find((p) => p.isYou);
    const readyCount = team.filter((p) => p.ready).length;
    const summary = teamSummary(team);
    const ended = Boolean(result) || room.phase === 'finished';
    const playing = started && !ended && !!me && !me.finished && !me.gaveUp;
    const copyCode = async () => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Could not copy to the clipboard');
        }
    };
    const leaveTeam = () => conn.current?.giveUp();

    if (!web3.address) {
        return (
            <div className="page">
                <EmptyState icon={<Users size={28} />} title="Connect a wallet to join this co-op room">
                    Co-op rooms know players by wallet address. Connect one, then this page joins room <b>{code}</b>.
                </EmptyState>
            </div>
        );
    }

    return (
        <div className="page page-race page-coop">
            <header className="race-head">
                <div className="row">
                    <h1 className="page-title">Co-op</h1>
                    {online === 'live' ? (
                        <Pill tone="green" pulse>
                            LIVE
                        </Pill>
                    ) : online === 'connecting' ? (
                        <Pill tone="amber" pulse>
                            Connecting
                        </Pill>
                    ) : (
                        <Pill tone="red">Not connected</Pill>
                    )}
                </div>
                <span className="race-ping">
                    <HandHeart size={14} aria-hidden /> Shared checkpoints · everyone must reach the flag
                </span>
            </header>

            {joinError && (
                <div className="notice notice-error" role="alert">
                    <span>Could not join co-op room {code} ({joinError}). Check the code, or create a new room.</span>
                    <Button size="sm" variant="secondary" to="/coop/new">
                        Back to co-op
                    </Button>
                </div>
            )}

            <div className="race-layout">
                <Card className="lobby">
                    <div className="invite-card">
                        <span className="invite-label">Room code: share it with your team</span>
                        <div className="invite-code" aria-label={`Room code ${code.split('').join(' ')}`}>
                            {code}
                        </div>
                        <div className="invite-actions">
                            <Button size="sm" variant="secondary" icon={copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} onClick={() => void copyCode()}>
                                {copied ? 'Copied' : 'Copy code'}
                            </Button>
                        </div>
                        <span className="fine">Teammates open Co-op and type the code under “Join with a code”. No stake.</span>
                    </div>
                    {!started && (
                        <ol className="lobby-steps" aria-label="Before the run">
                            <li className={cx(team.length >= room.minPlayers && 'is-done')}>
                                Wait for the whole team ({team.length} / {room.minPlayers} here)
                            </li>
                            <li className={cx(me?.ready && 'is-done')}>Press “I’m ready”: the run starts when everyone is ready</li>
                        </ol>
                    )}
                    <span className="fine lobby-count">
                        <Users size={13} aria-hidden /> {team.length} / {room.minPlayers} players · {readyCount} ready
                    </span>
                    <ul className="player-list" aria-label="Team">
                        {team.map((p) => (
                            <li key={p.sessionId} className={cx('player-row', p.isYou && 'is-you')}>
                                <Avatar color={hex(p.color)} size={38} />
                                <div className="player-text">
                                    <span className="player-addr" title={p.address}>
                                        {shortAddr(p.address, 4, 4)} {p.isYou && <Badge tone="violet">You</Badge>}
                                    </span>
                                    <span className={cx('player-stake', p.finished && 'ok')}>{memberStatus(p, started)}</span>
                                </div>
                                {!started && <Pill tone={p.ready ? 'green' : 'neutral'}>{p.ready ? 'Ready' : 'Not ready'}</Pill>}
                            </li>
                        ))}
                        {!started &&
                            Array.from({ length: Math.max(0, room.minPlayers - team.length) }, (_, i) => (
                                <li key={`empty-${i}`} className="player-row is-empty">
                                    <Hourglass size={18} aria-hidden /> Waiting for a teammate…
                                </li>
                            ))}
                    </ul>
                    {online === 'live' && web3.blocker && <BlockerNotice compact />}
                    <Button
                        variant={me?.ready ? 'secondary' : 'primary'}
                        size="lg"
                        block
                        onClick={() => conn.current?.ready()}
                        disabled={online !== 'live' || started || countdown !== null || !!me?.ready}
                        icon={me?.ready ? <Check size={18} aria-hidden /> : undefined}
                    >
                        {ended ? 'Run over' : started ? 'Run in progress' : countdown !== null ? 'Starting…' : me?.ready ? 'Ready — waiting for the team' : 'I’m ready'}
                    </Button>
                </Card>

                <Card className="race-stage-card" pad={false}>
                    <div className="race-stage-head">
                        <h2 className="card-title">{levelName}</h2>
                        <span className="fine">{ended ? 'Run over' : started ? 'Run in progress' : 'Lobby: warm up while the team gets ready'}</span>
                        {started && room.checkpointCount > 0 && (
                            <Pill tone="violet">
                                <MapPin size={12} aria-hidden /> Team checkpoint {room.shared + 1} / {room.checkpointCount}
                            </Pill>
                        )}
                        {playing && (
                            <div className="race-actions">
                                <Button size="sm" variant="secondary" icon={<RotateCcw size={14} aria-hidden />} onClick={() => EventBus.emit('play:restart')}>
                                    Respawn (R)
                                </Button>
                                <Button size="sm" variant="ghost" icon={<LogOut size={14} aria-hidden />} onClick={leaveTeam}>
                                    Give up
                                </Button>
                            </div>
                        )}
                    </div>
                    <div className="play-stage race-stage">
                        {file.data && levelId !== null && online === 'live' ? (
                            <PhaserGame key={levelId} scene={SCENES.Coop} data={{ level: file.data, levelId: String(levelId), roomCode: code, creator: meta.data?.creator ? shortAddr(meta.data.creator) : undefined }} />
                        ) : (
                            <div className="stage-loading">
                                <Skeleton w="100%" h="100%" r={0} />
                            </div>
                        )}
                        <div className="ranking" aria-label="Team">
                            <b>Team</b>
                            <ol>
                                {team.map((p) => (
                                    <li key={p.sessionId}>
                                        <span className="pcolor" style={{ background: hex(p.color) }} aria-hidden />
                                        {p.isYou ? 'You' : shortAddr(p.address, 4, 3)}
                                        <span className="coop-flag">{p.finished ? formatMs(p.finishTimeMs) : started && (p.gaveUp || !p.connected) ? 'out' : ''}</span>
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
                        <Flag size={15} aria-hidden /> {me?.gaveUp ? 'You gave up: the team cannot clear this run' : 'Everyone must reach the flag · a fall respawns you at the team checkpoint'}
                    </div>
                </Card>
            </div>

            {ended && <TeamResult team={team} result={result} summary={summary} />}
        </div>
    );
}

function memberStatus(p: Teammate, started: boolean) {
    if (!started) return p.connected ? 'In the lobby' : 'Disconnected';
    if (p.finished) return `At the flag · ${formatMs(p.finishTimeMs)}`;
    if (p.disqualified) return 'Disqualified by the server';
    if (p.gaveUp) return 'Gave up';
    if (!p.connected) return 'Disconnected';
    return 'Playing';
}

/** Team result: the clear, the team time (last arrival), the combined time and each player's split. */
function TeamResult({ team, result, summary }: { team: Teammate[]; result: CoopResultMessage | null; summary: ReturnType<typeof teamSummary> }) {
    const cleared = result ? result.cleared : summary.cleared;
    const sorted = [...team].sort((a, b) => (a.finished ? a.finishTimeMs : Infinity) - (b.finished ? b.finishTimeMs : Infinity));
    return (
        <Card className={cx('coop-result', cleared ? 'is-clear' : 'is-fail')} aria-label="Team result">
            <CardHeader icon={<Flag size={18} />} title={cleared ? 'Team clear!' : 'The team did not clear'} />
            <p className="fine">{cleared ? 'Everyone reached the flag. The server timed the run and signed each player’s result.' : 'Not everyone reached the flag before the run ended (time limit, a teammate gave up or was disqualified).'}</p>
            <div className="stat-row coop-stats">
                <Stat icon={<Timer size={18} />} label="Team time" value={formatMs(summary.teamTimeMs)} hint="When the last teammate reached the flag" />
                <Stat icon={<Timer size={18} />} label="Combined time" value={formatMs(summary.combinedMs)} hint="Sum of every player’s time" />
                <Stat icon={<Users size={18} />} label="At the flag" value={`${summary.finishers} / ${summary.total}`} />
            </div>
            <ol className="coop-splits" aria-label="Player times">
                {sorted.map((p) => (
                    <li key={p.sessionId} className={cx(p.isYou && 'is-you')}>
                        <span className="pcolor" style={{ background: hex(p.color) }} aria-hidden />
                        <span className="coop-split-name">
                            {shortAddr(p.address)} {p.isYou && <Badge tone="violet">You</Badge>}
                        </span>
                        <b>{p.finished ? formatMs(p.finishTimeMs) : memberStatus(p, true)}</b>
                    </li>
                ))}
            </ol>
            {result?.error && <p className="fine">{result.error === 'unpublished level: nothing to settle' ? 'This level is not published, so there is no on-chain reward.' : `Server: ${result.error}`}</p>}
            {result?.signed && <ClaimReward signed={result.signed} />}
        </Card>
    );
}

/** Settle this player's signed co-op RunResult like a solo clear: permit (one tx), else approve + settleRun. */
function ClaimReward({ signed }: { signed: NonNullable<CoopResultMessage['signed']> }) {
    const settle = useSettleRun();
    const tx = useTxFlow();
    const [done, setDone] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const claim = async () => {
        setError(null);
        const copy = { title: 'Claim co-op reward', success: 'Reward claimed', successBody: 'Play fee paid to the level owner and your reward minted.' };
        let out = await tx.run('coop-claim', copy, () => settle.settleWithPermit(signed.result, signed.signature as Hex));
        if (!out.ok && out.error && !isUserRejection(out.error)) {
            const ap = await tx.run('coop-approve', { title: 'Approve the play fee' }, () => settle.approveFee(signed.result.levelId));
            if (ap.ok) out = await tx.run('coop-claim', copy, () => settle.settle(signed.result, signed.signature as Hex));
            else out = ap;
        }
        if (out.ok) setDone(true);
        else if (out.error) setError(out.error);
    };
    return (
        <div className="coop-claim">
            <span className="fine">
                Your signed result: {signed.result.cleared ? `clear in ${formatMs(signed.result.timeMs)}` : 'no clear'} · {signed.result.coins} coins. Settling it pays the level’s play fee and mints your reward.
            </span>
            <Button variant="primary" disabled={done || !signed.result.cleared} loading={tx.isBusy('coop-claim') || tx.isBusy('coop-approve')} onClick={() => void claim()}>
                {done ? 'Reward claimed' : 'Claim reward on-chain'}
            </Button>
            {error && <span className="fine coop-error">{error}</span>}
        </div>
    );
}
