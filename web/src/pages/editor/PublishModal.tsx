import { useEffect, useState } from 'react';
import { parseUnits, type Hex } from 'viem';
import { useAccount } from 'wagmi';
import { api, ipfsToHttp } from '../../api/client';
import { EventBus } from '../../game/EventBus';
import { layoutHash } from '../../game/level/serialize';
import type { LevelFileV1 } from '../../game/level/types';
import { usePublishLevel } from '../../contracts/hooks';
import { contractsConfigured } from '../../contracts/addresses';
import type { RunSubmission } from '../../game/run';

export interface CreatorClear {
    hash: Hex;
    timeMs: number;
    inputs: Array<[number, number]>;
    /** Trace + checkpoints + input log the server validates for the ClearProof. */
    run: RunSubmission;
}

type StepState = 'todo' | 'active' | 'done' | 'error';
const STEPS = ['Thumbnail', 'Upload to IPFS', 'Clear check', 'Mint LevelNFT'] as const;
const SUB = ['game.renderer.snapshot', 'Level JSON + thumbnail + metadata', 'Server-signed ClearProof', 'LevelNFT.publish(...)'];

/**
 * Publish flow (SPEC §3.3): 1. clear proof from server, 2. thumbnail, 3. IPFS pin, 4. mint.
 */
export function PublishModal({ level, clear, onClose }: { level: LevelFileV1; clear: CreatorClear | null; onClose: () => void }) {
    const { address } = useAccount();
    const pub = usePublishLevel();
    const [name, setName] = useState(level.meta.name);
    const [fee, setFee] = useState('5');
    const [remixOf, setRemixOf] = useState(level.meta.parentId ? `#${level.meta.parentId}` : '');
    const [thumb, setThumb] = useState<string | null>(null);
    const [states, setStates] = useState<StepState[]>(['todo', 'todo', 'todo', 'todo']);
    const [notes, setNotes] = useState<string[]>([...SUB]);
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);

    const hash = layoutHash(level);
    const cleared = clear?.hash === hash;

    useEffect(() => {
        const off = EventBus.subscribe('editor:snapshot', setThumb);
        EventBus.emit('editor:request-snapshot');
        return off;
    }, []);

    const mark = (i: number, s: StepState, note?: string) => {
        setStates((prev) => prev.map((v, j) => (j === i ? s : v)));
        if (note) setNotes((prev) => prev.map((v, j) => (j === i ? note : v)));
    };

    async function run() {
        setError(null);
        setRunning(true);
        let i = 0;
        try {
            if (!address) throw new Error('Connect your wallet first.');
            if (!cleared || !clear) throw new Error('Finish your level in test play (press T) before publishing.');
            const file: LevelFileV1 = { ...level, meta: { ...level.meta, name, parentId: Number(remixOf.replace('#', '')) || undefined } };

            mark(0, 'active');
            const image = thumb ?? (await new Promise<string>((res) => {
                const off = EventBus.subscribe('editor:snapshot', (d) => {
                    off();
                    res(d);
                });
                EventBus.emit('editor:request-snapshot');
            }));
            setThumb(image);
            mark(0, 'done');

            i = 1;
            mark(1, 'active');
            const pin = await api.pinLevel({ level: file, thumbnail: image, description: file.meta.description ?? `${name} — a RealmForge level` });
            if (pin.alreadyPublished) throw new Error('This exact layout is already published.');
            mark(1, 'done', `CID ${pin.levelCid.slice(0, 10)}…`);

            i = 2;
            mark(2, 'active');
            const proof = await api.requestClearProof({ creator: address, layoutHash: pin.layoutHash, run: clear.run });
            mark(2, 'done');

            i = 3;
            mark(3, 'active', 'Confirm in your wallet');
            if (!contractsConfigured) throw new Error('VITE_LEVEL_NFT_ADDRESS is not configured.');
            await pub.publish({
                layoutHash: proof.proof.layoutHash,
                uri: proof.tokenURI ?? pin.tokenURI,
                playFee: parseUnits(fee || '0', 18),
                parentId: BigInt(Number(remixOf.replace('#', '')) || 0),
                deadline: BigInt(proof.proof.deadline),
                clearSig: proof.signature,
            });
            mark(3, 'done', 'Transaction sent');
        } catch (e) {
            mark(i, 'error');
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setRunning(false);
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="row between">
                    <div>
                        <h2 style={{ fontSize: 26 }}>Publish level</h2>
                        <p className="muted" style={{ margin: '4px 0 16px' }}>
                            Ready to forge your level NFT
                        </p>
                    </div>
                    <button className="btn ghost" onClick={onClose} aria-label="Close">
                        ✕
                    </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    <div className="stack">
                        <div style={{ aspectRatio: '16/9', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', background: '#0b1020' }}>
                            {thumb && <img src={ipfsToHttp(thumb)} alt="Level thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                        </div>
                        <label className="field">
                            Name
                            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
                        </label>
                        <label className="field">
                            Play fee (FORGE, max 100)
                            <input className="input" type="number" min={0} max={100} value={fee} onChange={(e) => setFee(e.target.value)} />
                        </label>
                        <label className="field">
                            Remix of
                            <input className="input" placeholder="#12 (optional)" value={remixOf} onChange={(e) => setRemixOf(e.target.value)} />
                        </label>
                    </div>
                    <div className="steps">
                        {STEPS.map((s, i) => (
                            <div key={s} className={`step ${states[i]}`}>
                                <span className="n">{states[i] === 'done' ? '✓' : i + 1}</span>
                                <div>
                                    <b>{s}</b>
                                    <div className="muted" style={{ fontSize: 13 }}>
                                        {notes[i]}
                                    </div>
                                </div>
                            </div>
                        ))}
                        <div className="muted mono" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                            layoutHash {hash}
                        </div>
                        {!cleared && <div className="error">Not cleared yet — test-play (T) and reach the goal first.</div>}
                    </div>
                </div>
                {error && (
                    <p className="error" style={{ marginTop: 16 }}>
                        {error}
                    </p>
                )}
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
                    <button className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button className="btn gold" disabled={running} onClick={() => void run()}>
                        {running ? 'Publishing…' : '⇪ Publish'}
                    </button>
                </div>
            </div>
        </div>
    );
}
