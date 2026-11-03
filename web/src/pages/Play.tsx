import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Hex } from 'viem';
import { CheckCircle2, Circle, Clock, Coins, Flag, Info, LogOut, Pause, Play as PlayIcon, RefreshCw, RotateCcw, Skull, Trophy, XCircle } from 'lucide-react';
import { api } from '../api/client';
import { useMockData } from '../api/dataSource';
import { PhaserGame } from '../game/PhaserGame';
import { EventBus, type RunFinished } from '../game/EventBus';
import { SCENES } from '../game/constants';
import { AddressChip, Badge, Button, EmptyState, ForgeCoin, Kbd, Modal, Skeleton, TokenAmount, Tooltip, cx, formatMs } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { useSettleRun } from '../contracts/hooks';
import { BlockerNotice } from '../components/BlockerNotice';
import { humanizeError, isUserRejection } from '../web3/errors';
import { useServiceStatus, useTxFlow, useWeb3Status } from '../web3/tx';
import { toast } from '../components/ui';

type Phase = 'intro' | 'playing' | 'paused' | 'dead' | 'cleared';
type StepState = 'todo' | 'active' | 'done' | 'error';

/** Mirrors ForgeCoin._computeReward: min(5 + 45·(1 − clears/plays), 50), before first-clear / record bonuses. */
export const estimateReward = (clearRate: number) => Math.round(Math.min(5 + 45 * (1 - (Number.isFinite(clearRate) ? clearRate : 1)), 50));

const CONTROLS: [string[], string][] = [
    [['A', 'D'], 'Move'],
    [['Space'], 'Jump'],
    [['Shift'], 'Run'],
    [['R'], 'Restart'],
    [['Esc'], 'Pause'],
];

function ControlsList({ compact }: { compact?: boolean }) {
    return (
        <ul className={cx('controls', compact && 'controls-compact')} aria-label="Controls">
            {CONTROLS.map(([keys, label]) => (
                <li key={label}>
                    {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                    ))}
                    <span>{label}</span>
                </li>
            ))}
        </ul>
    );
}

function StepRow({ state, title, note }: { state: StepState; title: string; note: string }) {
    return (
        <li className={cx('step', `step-${state}`)} aria-current={state === 'active' ? 'step' : undefined}>
            <span className="step-mark" aria-hidden>
                {state === 'done' ? <CheckCircle2 size={20} /> : state === 'error' ? <XCircle size={20} /> : state === 'active' ? <span className="step-spinner" /> : <Circle size={20} />}
            </span>
            <div>
                <b>{title}</b>
                <span>{note}</span>
            </div>
            <span className="sr-only">{state === 'done' ? 'done' : state === 'active' ? 'in progress' : state === 'error' ? 'failed' : 'to do'}</span>
        </li>
    );
}

/** Solo settlement (SPEC §3.6/§5.3): server validates + signs RunResult → permit (or approve) → settleRun. */
function SettlePanel({ levelId, result, fee, onSettled }: { levelId: number; result: RunFinished; fee: string; onSettled: () => void }) {
    const web3 = useWeb3Status();
    const svc = useServiceStatus();
    const settle = useSettleRun();
    const tx = useTxFlow();
    const [steps, setSteps] = useState<StepState[]>(['todo', 'todo', 'todo']);
    const [notes, setNotes] = useState(['Server re-checks the trace and signs RunResult (EIP-712)', 'One permit signature (ERC-2612), no extra transaction', `ForgeCoin.settleRun pays ${fee} FORGE and mints your reward`]);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [done, setDone] = useState(false);
    // The server signs a given recording only once (409 afterwards), so a retry after a failed
    // transaction must reuse the signature it already has until its deadline passes.
    const signedRef = useRef<Awaited<ReturnType<typeof api.submitRun>> | null>(null);
    const mark = (i: number, s: StepState, note?: string) => {
        setSteps((p) => p.map((v, j) => (j === i ? s : v)));
        if (note) setNotes((p) => p.map((v, j) => (j === i ? note : v)));
    };

    const submit = async () => {
        if (!web3.address) return;
        setError(null);
        setRunning(true);
        let i = 0;
        try {
            mark(0, 'active');
            const cached = signedRef.current;
            const stillValid = cached && cached.result.player.toLowerCase() === web3.address.toLowerCase() && Number(cached.result.deadline) > Date.now() / 1000 + 60;
            const signed = stillValid ? cached : await api.submitRun({ player: web3.address, levelId, run: result.run });
            signedRef.current = signed;
            const r = signed.result;
            const runResult = { player: r.player, levelId: BigInt(r.levelId), timeMs: r.timeMs, cleared: r.cleared, coins: r.coins, nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) };
            mark(0, 'done', `Signed by ${signed.signer.slice(0, 8)}… · nonce ${r.nonce}`);

            i = 1;
            mark(1, 'active', 'Sign the permit in your wallet');
            let fallback = false;
            let out = await tx.run('settle', { title: 'Settle run', success: 'Run settled on-chain', successBody: 'Fee paid to the level owner and reward minted to you.' }, () => settle.settleWithPermit(runResult, signed.signature as Hex));
            if (!out.ok && out.error && !isUserRejection(out.error)) {
                // Permit failed for any reason except the user clicking Reject (e.g. a wallet without eth_signTypedData_v4): classic approve + settleRun (two transactions).
                fallback = true;
                mark(1, 'active', 'Permit unavailable — approving the fee instead (transaction 1 of 2)');
                const ap = await tx.run('approve', { title: `Approve ${fee} FORGE` }, () => settle.approveFee(runResult.levelId));
                if (!ap.ok) throw new Error(ap.error);
                mark(1, 'done', 'Fee approved');
                i = 2;
                mark(2, 'active', 'Confirm settleRun (transaction 2 of 2)');
                out = await tx.run('settle', { title: 'Settle run', success: 'Run settled on-chain' }, () => settle.settle(runResult, signed.signature as Hex));
            }
            if (!out.ok) throw new Error(out.error);
            if (!fallback) mark(1, 'done', 'Permit signed');
            mark(2, 'done', 'Confirmed on-chain');
            setDone(true);
            onSettled();
        } catch (e) {
            const msg = humanizeError(e);
            mark(i, 'error', msg);
            setError(msg);
            if (i === 0) toast.error('Run validation failed', msg);
        } finally {
            setRunning(false);
        }
    };

    const blocked = !!web3.blocker || svc.api === 'offline';
    return (
        <div className="settle">
            <ol className="steps" aria-label="Settle run progress">
                <StepRow state={steps[0]} title="Validate run" note={notes[0]} />
                <StepRow state={steps[1]} title="Authorise the play fee" note={notes[1]} />
                <StepRow state={steps[2]} title="Settle on-chain" note={notes[2]} />
            </ol>
            <details className="explain">
                <summary>
                    <Info size={14} aria-hidden /> Permit or approve?
                </summary>
                <p>
                    With <b>permit</b> (ERC-2612) you sign a free, off-chain message allowing ForgeCoin to take exactly the play fee, then one transaction settles the run. If your wallet cannot sign permits, RealmForge falls back to the classic <b>approve</b> transaction followed by <code>settleRun</code>: two transactions, two gas fees.
                </p>
            </details>
            {svc.api === 'offline' && (
                <div className="notice notice-warn" role="status">
                    <span>
                        The game server is offline, so the run cannot be validated and signed. Start it with <code>npm run dev:server</code>, then play again.
                    </span>
                </div>
            )}
            <BlockerNotice />
            {error && (
                <div className="notice notice-error" role="alert">
                    {error}
                </div>
            )}
            <div className="settle-actions">
                <Button variant="gold" size="lg" loading={running} disabled={blocked || done} onClick={() => void submit()}>
                    {done ? 'Settled' : running ? (tx.stage === 'pending' ? 'Waiting for block…' : 'Working…') : error ? 'Retry settlement' : `Settle run · pay ${fee} FORGE`}
                </Button>
            </div>
        </div>
    );
}

export default function Play() {
    const id = Number(useParams().id);
    const navigate = useNavigate();
    const meta = useAsync(() => api.getLevel(id), [id]);
    const file = useAsync(() => api.getLevelFile(id), [id]);
    const mockFile = useMockData('/levels/1/file');
    const [phase, setPhase] = useState<Phase>('intro');
    const [introOpen, setIntroOpen] = useState(true);
    const [lives, setLives] = useState<number | undefined>();
    const [result, setResult] = useState<RunFinished | null>(null);
    const [deaths, setDeaths] = useState(0);
    const [ouch, setOuch] = useState(false);
    const holdRef = useRef(false);
    const introRef = useRef(true);
    introRef.current = introOpen;

    const focusCanvas = () => document.querySelector<HTMLElement>('.play-stage .game-container')?.focus();

    useEffect(() => {
        const holdForIntro = () => {
            // The scene starts running immediately; hold it behind the pre-play card until the player is ready.
            if (introRef.current && !holdRef.current) {
                holdRef.current = true;
                EventBus.emit('play:pause', true);
            }
        };
        let gotState = false;
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
        const offs = [
            EventBus.subscribe('play:state', (s) => {
                gotState = true;
                setPhase(s.state);
                if (s.lives !== undefined) setLives(s.lives);
                if (s.state === 'playing') holdForIntro();
                if (s.state === 'dead') setOuch(true);
            }),
            EventBus.subscribe('current-scene-ready', (scene) => {
                // Scenes that emit play:state hold on 'playing' (after their own intro); older scenes get held here.
                if (scene.scene.key === SCENES.Play) fallbackTimer = setTimeout(() => !gotState && holdForIntro(), 1200);
            }),
            EventBus.subscribe('play:died', () => {
                setDeaths((d) => d + 1);
                setOuch(true);
            }),
            EventBus.subscribe('play:finished', (r) => {
                setResult(r);
                setPhase('cleared');
            }),
        ];
        return () => {
            clearTimeout(fallbackTimer);
            offs.forEach((o) => o());
        };
    }, []);

    useEffect(() => {
        if (!ouch) return;
        const t = setTimeout(() => setOuch(false), 1400);
        return () => clearTimeout(t);
    }, [ouch, deaths]);

    const start = () => {
        setIntroOpen(false);
        setPhase('playing');
        EventBus.emit('play:resume');
        requestAnimationFrame(focusCanvas);
    };
    const restart = useCallback(() => {
        setResult(null);
        setDeaths(0);
        setPhase('playing');
        EventBus.emit('play:restart');
        requestAnimationFrame(focusCanvas);
    }, []);
    const pause = useCallback(() => {
        EventBus.emit('play:pause', true);
        setPhase('paused');
    }, []);
    const resume = useCallback(() => {
        EventBus.emit('play:resume');
        setPhase('playing');
        requestAnimationFrame(focusCanvas);
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return;
            if (introRef.current || result) return;
            if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
                e.preventDefault();
                if (phase === 'paused') resume();
                else if (phase === 'playing') pause();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [phase, result, pause, resume]);

    const lvl = meta.data;
    const fee = lvl?.playFee ?? '—';
    const reward = lvl ? estimateReward(lvl.clearRate) : null;
    const gameOver = phase === 'dead' && lives === 0;

    if (!Number.isInteger(id) || id <= 0) return <EmptyState tone="error" title="Invalid level id" action={<Button to="/browse">Browse levels</Button>} />;

    return (
        <div className="page page-play">
            <header className="play-head">
                <div>
                    <h1 className="page-title">{lvl?.name ?? <Skeleton w={260} h={34} />}</h1>
                    <div className="play-by">
                        by <AddressChip address={lvl?.creator} copy={false} />
                        {mockFile && <Badge tone="neutral">Sample level file</Badge>}
                    </div>
                </div>
                <div className="play-actions">
                    <Tooltip content="Restart from spawn" shortcut="R">
                        <Button size="lg" icon={<RotateCcw size={18} aria-hidden />} onClick={restart} disabled={introOpen}>
                            Restart
                        </Button>
                    </Tooltip>
                    <Tooltip content={phase === 'paused' ? 'Resume' : 'Pause'} shortcut="Esc">
                        <Button size="lg" variant="primary" icon={phase === 'paused' ? <PlayIcon size={18} aria-hidden /> : <Pause size={18} aria-hidden />} onClick={phase === 'paused' ? resume : pause} disabled={introOpen || !!result}>
                            {phase === 'paused' ? 'Resume' : 'Pause'}
                        </Button>
                    </Tooltip>
                </div>
            </header>

            <div className="play-stage">
                {file.error && !file.data ? (
                    <EmptyState tone="error" title="Level file could not be loaded" action={<Button icon={<RefreshCw size={15} aria-hidden />} onClick={file.reload}>Retry</Button>}>
                        {file.error.message}
                    </EmptyState>
                ) : file.data && (meta.data || meta.error) ? (
                    // Sample mode: the bundled sample file takes the listed level's theme and name so the page stays coherent.
                    <PhaserGame scene={SCENES.Play} data={{ level: mockFile && meta.data ? { ...file.data, meta: { ...file.data.meta, theme: meta.data.theme, name: meta.data.name } } : file.data, levelId: String(id), from: 'play' }} />
                ) : (
                    <div className="stage-loading">
                        <Skeleton w="100%" h="100%" r={0} />
                        <span>Loading level from IPFS…</span>
                    </div>
                )}

                {ouch && !gameOver && !result && (
                    <div className="stage-toast" role="status">
                        <Skull size={16} aria-hidden /> Ouch! Back to the last checkpoint{lives !== undefined ? ` · ${lives} lives left` : ''}
                    </div>
                )}

                <Modal
                    inline
                    open={introOpen && Boolean(file.data)}
                    onClose={start}
                    title={lvl?.name ?? `Level #${id}`}
                    description="Reach the flag as fast as you can. Your run is recorded frame by frame for validation."
                    icon={<Flag size={20} />}
                    className="preplay"
                    footer={
                        <>
                            <Button onClick={() => navigate(`/level/${id}`)} icon={<LogOut size={16} aria-hidden />}>
                                Level page
                            </Button>
                            <Button variant="primary" size="lg" icon={<PlayIcon size={18} aria-hidden fill="currentColor" />} onClick={start} data-autofocus>
                                Start run
                            </Button>
                        </>
                    }
                >
                    <dl className="preplay-grid">
                        <div>
                            <dt>Play fee</dt>
                            <dd>
                                <TokenAmount value={fee} size="lg" />
                            </dd>
                        </div>
                        <div>
                            <dt>Reward on clear (est.)</dt>
                            <dd>
                                <TokenAmount value={reward} sign="+" size="lg" />
                            </dd>
                        </div>
                        <div>
                            <dt>Best time</dt>
                            <dd className="num">{formatMs(lvl?.bestTimeMs)}</dd>
                        </div>
                    </dl>
                    <p className="fine">The fee is only charged when you settle a cleared run on-chain. Practice runs are free.</p>
                    <ControlsList />
                </Modal>

                <Modal
                    inline
                    open={phase === 'paused' && !introOpen && !result}
                    onClose={resume}
                    title="Paused"
                    icon={<Pause size={20} />}
                    size="sm"
                    footer={
                        <>
                            <Button icon={<LogOut size={16} aria-hidden />} onClick={() => navigate(`/level/${id}`)}>
                                Quit
                            </Button>
                            <Button icon={<RotateCcw size={16} aria-hidden />} onClick={restart}>
                                Restart
                            </Button>
                            <Button variant="primary" icon={<PlayIcon size={16} aria-hidden />} onClick={resume} data-autofocus>
                                Resume
                            </Button>
                        </>
                    }
                >
                    <ControlsList compact />
                </Modal>

                <Modal
                    open={gameOver && !result}
                    onClose={restart}
                    title="Game over"
                    description={`You ran out of lives after ${deaths} fall${deaths === 1 ? '' : 's'}. Nothing was charged.`}
                    icon={<Skull size={20} />}
                    size="sm"
                    footer={
                        <>
                            <Button onClick={() => navigate(`/level/${id}`)}>Level page</Button>
                            <Button variant="primary" icon={<RotateCcw size={16} aria-hidden />} onClick={restart} data-autofocus>
                                Try again
                            </Button>
                        </>
                    }
                />

                <Modal
                    open={Boolean(result)}
                    onClose={restart}
                    title="Level cleared!"
                    icon={<Trophy size={20} />}
                    className="results"
                    size="lg"
                    footer={
                        <>
                            <Button onClick={() => navigate(`/level/${id}`)} icon={<LogOut size={16} aria-hidden />}>
                                Level page
                            </Button>
                            <Button icon={<RotateCcw size={16} aria-hidden />} onClick={restart} data-autofocus>
                                Play again
                            </Button>
                        </>
                    }
                >
                    {result && (
                        <>
                            <dl className="result-stats">
                                <div>
                                    <dt>
                                        <Clock size={16} aria-hidden /> Time
                                    </dt>
                                    <dd className="num">{formatMs(result.timeMs)}</dd>
                                    {lvl?.bestTimeMs != null && (
                                        <span className={result.timeMs < lvl.bestTimeMs ? 'delta good' : 'delta'}>{result.timeMs < lvl.bestTimeMs ? 'New record pace' : `+${formatMs(result.timeMs - lvl.bestTimeMs)} vs best`}</span>
                                    )}
                                </div>
                                <div>
                                    <dt>
                                        <Coins size={16} aria-hidden /> Coins
                                    </dt>
                                    <dd className="num">{result.coins}</dd>
                                </div>
                                <div>
                                    <dt>
                                        <Trophy size={16} aria-hidden /> Reward (est.)
                                    </dt>
                                    <dd>
                                        <TokenAmount value={reward} sign="+" size="lg" />
                                    </dd>
                                </div>
                            </dl>
                            <SettlePanel levelId={id} result={result} fee={fee} onSettled={() => meta.reload()} />
                        </>
                    )}
                </Modal>
            </div>

            <footer className="play-foot">
                <div className="play-economy">
                    <ForgeCoin size={26} />
                    <span>
                        Level fee <b className="gold">{fee} FORGE</b>
                    </span>
                    <span className="dot-sep" aria-hidden>
                        ·
                    </span>
                    <span>
                        Reward on clear <b className="gold">+{reward ?? '—'} FORGE</b>
                    </span>
                    <Link to={`/level/${id}`} className="fine-link">
                        Leaderboard
                    </Link>
                </div>
                <ControlsList compact />
            </footer>
        </div>
    );
}
