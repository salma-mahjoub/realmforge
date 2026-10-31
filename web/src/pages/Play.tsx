import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount } from 'wagmi';
import type { Hex } from 'viem';
import { api } from '../api/client';
import { PhaserGame } from '../game/PhaserGame';
import { EventBus, type HudState, type RunFinished } from '../game/EventBus';
import { SCENES } from '../game/constants';
import { formatMs, shortAddr } from '../components/ui';
import { useAsync } from '../components/useAsync';
import { useSettleRun } from '../contracts/hooks';

export default function Play() {
    const id = Number(useParams().id);
    const { address } = useAccount();
    const { data: meta } = useAsync(() => api.getLevel(id), [id]);
    const { data: file, error } = useAsync(() => api.getLevelFile(id), [id]);
    const [hud, setHud] = useState<HudState>({ timeMs: 0, coins: 0, checkpoint: null });
    const [paused, setPaused] = useState(false);
    const [result, setResult] = useState<RunFinished | null>(null);
    const [submitState, setSubmitState] = useState<string | null>(null);
    const settle = useSettleRun();

    useEffect(() => {
        const offs = [EventBus.subscribe('play:hud', setHud), EventBus.subscribe('play:finished', setResult)];
        return () => offs.forEach((o) => o());
    }, []);

    const restart = () => {
        setResult(null);
        setPaused(false);
        setSubmitState(null);
        EventBus.emit('play:restart');
    };

    const togglePause = () => {
        EventBus.emit('play:pause', !paused);
        setPaused(!paused);
    };

    /** Solo run settlement: server validates the run and signs RunResult (§3.6), then approve + settleRun (§5.3). */
    const submit = async () => {
        if (!result || !address) return;
        try {
            setSubmitState('Validating run on server…');
            const signed = await api.submitRun({ player: address, levelId: id, run: result.run });
            const r = signed.result;
            const runResult = { player: r.player, levelId: BigInt(r.levelId), timeMs: r.timeMs, cleared: r.cleared, coins: r.coins, nonce: BigInt(r.nonce), deadline: BigInt(r.deadline) };
            setSubmitState('Sign the FORGE permit for the play fee, then confirm settleRunWithPermit…');
            try {
                await settle.settleWithPermit(runResult, signed.signature as Hex);
            } catch (permitErr) {
                console.warn('[settle] permit path failed, falling back to approve + settleRun', permitErr);
                setSubmitState('Approve the play fee, then confirm settleRun…');
                await settle.approveFee(runResult.levelId);
                await settle.settle(runResult, signed.signature as Hex);
            }
            setSubmitState('Run settled — transaction sent.');
        } catch (e) {
            setSubmitState(`Failed: ${e instanceof Error ? e.message : String(e)}`);
        }
    };

    return (
        <div className="stack play-page" style={{ gap: 18 }}>
            <style>{`
                .play-page h1 { font-size: clamp(26px, 3vw, 38px); letter-spacing: -.8px; line-height: 1.15; margin-bottom: 4px; }
                .play-page .play-stage { height: min(68vh, 640px); border-radius: 18px; overflow: hidden; border: 1px solid #344363; }
                .play-page .hud { top: 18px; left: 18px; border-radius: 16px; background: #0f1424d9; box-shadow: 0 4px 20px #0f142420; }
                .play-page .hud > div { padding: 13px 18px; gap: 10px; font-size: clamp(14px, 1.4vw, 20px); }
                .play-page .hud > div + div { border-left-color: #9ca5d52b; }
                .play-page .hud-symbol { font: 30px system-ui; line-height: 1; }
                .play-page .checkpoint-flag { color: #a47cff; font-size: 30px; line-height: 1; }
                .play-page .hud .coin, .play-page .economy-panel .coin { width: 25px; height: 25px; }
                .play-page .play-actions .btn { min-height: 46px; padding: 10px 18px; font-size: 16px; border-radius: 13px; }
                .play-page .economy-panel { padding: 15px 20px; border-radius: 17px; gap: 12px; background: linear-gradient(135deg, #20273f, #141a2c); }
                .play-page .controls-panel { padding: 12px 16px; font-size: 13px; border-radius: 17px; }
                @media (max-width: 640px) { .play-page .hud { top: 8px; left: 8px; } .play-page .hud > div { padding: 8px; } .play-page .economy-panel { flex-wrap: wrap; padding: 12px; } }
            `}</style>
            <div className="row between">
                <div>
                    <h1>{meta?.name ?? `Level #${id}`}</h1>
                    <span className="muted">
                        by <Link to={`/profile/${meta?.creator ?? ''}`} className="mono">{shortAddr(meta?.creator)}</Link>
                    </span>
                </div>
                <div className="row play-actions">
                    <button className="btn" onClick={restart}>
                        ↻ Restart
                    </button>
                    <button className="btn primary" onClick={togglePause}>
                        {paused ? '▶ Resume' : '❚❚ Pause'}
                    </button>
                </div>
            </div>

            <div className="play-stage">
                <div className="hud">
                    <div><span className="hud-symbol" aria-hidden="true">⏱</span><span className="mono">{formatMs(hud.timeMs)}</span></div>
                    <div>
                        <span className="coin" /> {hud.coins}
                    </div>
                    <div><span className="checkpoint-flag" aria-hidden="true">⚑</span>{hud.checkpoint ? 'Checkpoint' : 'Start'}</div>
                </div>
                {error && <div className="empty error">Could not load level file: {error.message}</div>}
                {file ? <PhaserGame scene={SCENES.Play} data={{ level: file, levelId: String(id), from: 'play' }} /> : <div className="game-container" />}

                {result && (
                    <div className="modal-backdrop" style={{ position: 'absolute', borderRadius: 10 }}>
                        <div className="modal" style={{ width: 420 }}>
                            <h2>Level cleared!</h2>
                            <p className="muted">
                                Time <b className="mono">{formatMs(result.timeMs)}</b> · {result.coins} coins · {result.inputs.length} input events recorded
                            </p>
                            <p style={{ fontSize: 14 }}>
                                Submit the run to pay the level fee and earn your clear reward (server-signed <span className="mono">RunResult</span>, then <span className="mono">ForgeCoin.settleRun</span>).
                            </p>
                            {submitState && <p className="muted" style={{ fontSize: 13 }}>{submitState}</p>}
                            <div className="row" style={{ justifyContent: 'flex-end' }}>
                                <button className="btn" onClick={restart}>
                                    Play again
                                </button>
                                <button className="btn gold" disabled={!address} onClick={() => void submit()} title={address ? '' : 'Connect a wallet first'}>
                                    Submit run
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="row between wrap">
                <div className="panel row economy-panel">
                    <span className="coin" /> Level fee <b className="gold">{meta?.playFee ?? '—'} FORGE</b>
                    <span className="muted">·</span> Reward on clear <b className="gold">+12 FORGE</b>
                </div>
                <div className="panel row controls-panel">
                    <span className="kbd">A</span>
                    <span className="kbd">D</span> Move
                    <span className="kbd">Space</span> Jump
                    <span className="kbd">Shift</span> Run
                    <span className="kbd">R</span> Restart
                </div>
            </div>
        </div>
    );
}
