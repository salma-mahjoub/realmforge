import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { decodeEventLog, parseUnits, type Hex } from 'viem';
import { CheckCircle2, Circle, ExternalLink as ExtIcon, Gem, ImageIcon, Play, Rocket, UploadCloud, Wallet, XCircle } from 'lucide-react';
import { api, ipfsToHttp } from '../../api/client';
import { EventBus } from '../../game/EventBus';
import { layoutHash } from '../../game/level/serialize';
import type { LevelFileV1 } from '../../game/level/types';
import { remixStatus, type RemixSource } from '../../game/level/remix';
import { usePublishLevel } from '../../contracts/hooks';
import { levelNftAbi } from '../../contracts/generated';
import type { RunSubmission } from '../../game/run';
import { Button, Field, ForgeCoin, Input, Modal, Spinner, cx, formatMs, shortAddr } from '../../components/ui';
import { BlockerNotice } from '../../components/BlockerNotice';
import { humanizeError } from '../../web3/errors';
import { useServiceStatus, useTxFlow, useWeb3Status } from '../../web3/tx';

export interface CreatorClear {
    hash: Hex;
    timeMs: number;
    inputs: Array<[number, number]>;
    /** Trace + checkpoints + input log the server validates for the ClearProof. */
    run: RunSubmission;
}

type StepState = 'todo' | 'active' | 'done' | 'error';
/** Execution order: the server only signs a ClearProof for a layout pinned through it (POST /levels/pin first). */
const STEPS = [
    { title: 'Thumbnail', note: 'Snapshot of the editor canvas', icon: <ImageIcon size={14} aria-hidden /> },
    { title: 'Upload to IPFS', note: 'Level JSON, thumbnail and metadata', icon: <UploadCloud size={14} aria-hidden /> },
    { title: 'Clear check', note: 'Server replays your clear and signs a ClearProof', icon: <CheckCircle2 size={14} aria-hidden /> },
    { title: 'Mint LevelNFT', note: 'LevelNFT.publish(...) from your wallet', icon: <Gem size={14} aria-hidden /> },
] as const;

function Check({ ok, children, action }: { ok: boolean; children: ReactNode; action?: ReactNode }) {
    return (
        <li className={cx('check', ok ? 'ok' : 'bad')}>
            {ok ? <CheckCircle2 size={16} aria-hidden /> : <XCircle size={16} aria-hidden />}
            <span>{children}</span>
            <span className="sr-only">{ok ? 'ready' : 'missing'}</span>
            {!ok && action}
        </li>
    );
}

/** Publish flow (SPEC §3.3) with a pre-flight checklist, a 4-step progress rail and readable errors. */
/**
 * Asks the editor scene for a snapshot of the level. The editor only answers while it is the active scene;
 * if nobody answers (for example the game is still on the test-play screen), fall back to the game canvas, which
 * is created with `preserveDrawingBuffer` so it can be read at any time.
 */
function requestThumbnail(timeoutMs = 1500): Promise<string> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const off = EventBus.subscribe('editor:snapshot', (img) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            off();
            resolve(img);
        });
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            off();
            const canvas = document.querySelector<HTMLCanvasElement>('.game-container canvas');
            try {
                if (!canvas) throw new Error('no game canvas');
                resolve(canvas.toDataURL('image/png'));
            } catch {
                reject(new Error('Could not capture a thumbnail of the level. Go back to the editor and try again.'));
            }
        }, timeoutMs);
        EventBus.emit('editor:request-snapshot');
    });
}

export function PublishModal({ level, remixSource, clear, onClose, onTestPlay }: { level: LevelFileV1; remixSource?: RemixSource | null; clear: CreatorClear | null; onClose: () => void; onTestPlay: () => void }) {
    const web3 = useWeb3Status();
    const svc = useServiceStatus();
    const pub = usePublishLevel();
    const tx = useTxFlow();
    const [name, setName] = useState(level.meta.name);
    const [fee, setFee] = useState('5');
    const [remixOf, setRemixOf] = useState(level.meta.parentId ? `#${level.meta.parentId}` : '');
    const [thumb, setThumb] = useState<string | null>(null);
    const [states, setStates] = useState<StepState[]>(['todo', 'todo', 'todo', 'todo']);
    const [notes, setNotes] = useState<string[]>(STEPS.map((s) => s.note));
    const [error, setError] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [minted, setMinted] = useState<{ id?: bigint; hash?: Hex } | null>(null);

    const hash = layoutHash(level);
    const cleared = clear?.hash === hash;
    const feeN = Number(fee);
    const feeError = fee === '' || !Number.isFinite(feeN) || feeN < 0 ? 'Enter a fee between 0 and 100' : feeN > 100 ? 'Maximum play fee is 100 FORGE' : null;
    const nameError = name.trim() ? null : 'Give your level a name';
    const remixError = remixOf && !/^#?\d+$/.test(remixOf.trim()) ? 'Use a level id, e.g. #12' : null;
    const parentId = Number(remixOf.replace('#', '')) || 0;
    // A remix must change the layout itself: LevelNFT refuses a layoutHash it has already minted (hashUsed).
    const remix = remixStatus({ ...level, meta: { ...level.meta, parentId: parentId || undefined } }, remixSource);
    const ready = cleared && !web3.blocker && svc.api !== 'offline' && !feeError && !nameError && !remixError && !remix.unchanged;
    const started = states.some((s) => s !== 'todo');

    useEffect(() => {
        let alive = true;
        requestThumbnail()
            .then((img) => alive && setThumb(img))
            .catch(() => undefined); // the publish step retries and shows the reason
        return () => {
            alive = false;
        };
    }, []);

    const mark = (i: number, s: StepState, note?: string) => {
        setStates((prev) => prev.map((v, j) => (j === i ? s : v)));
        if (note) setNotes((prev) => prev.map((v, j) => (j === i ? note : v)));
    };

    async function run() {
        if (!clear || !web3.address) return;
        setError(null);
        setRunning(true);
        setStates(['todo', 'todo', 'todo', 'todo']);
        setNotes(STEPS.map((s) => s.note));
        let i = 0;
        try {
            const file: LevelFileV1 = { ...level, meta: { ...level.meta, name: name.trim(), parentId: parentId || undefined } };

            mark(0, 'active');
            const image = thumb ?? (await requestThumbnail());
            setThumb(image);
            mark(0, 'done', 'Captured from the canvas');

            i = 1;
            mark(1, 'active', 'Pinning…');
            const pin = await api.pinLevel({ level: file, thumbnail: image, description: file.meta.description ?? `${file.meta.name}, a RealmForge level` });
            if (pin.alreadyPublished) throw new Error('This exact layout is already published. Change something and clear it again.');
            mark(1, 'done', `CID ${pin.levelCid.slice(0, 14)}… via ${pin.provider}`);

            i = 2;
            mark(2, 'active', 'Server is re-checking your clear…');
            const proof = await api.requestClearProof({ creator: web3.address, layoutHash: pin.layoutHash, run: clear.run });
            mark(2, 'done', `Signed by ${shortAddr(proof.signer)}`);

            i = 3;
            mark(3, 'active', 'Confirm in your wallet');
            const out = await tx.run('publish', { title: 'Mint LevelNFT', success: `“${file.meta.name}” is live on-chain` }, () =>
                pub.publish({
                    layoutHash: proof.proof.layoutHash,
                    uri: proof.tokenURI ?? pin.tokenURI,
                    playFee: parseUnits(fee || '0', 18),
                    parentId: BigInt(parentId),
                    deadline: BigInt(proof.proof.deadline),
                    clearSig: proof.signature,
                }),
            );
            if (!out.ok) throw new Error(out.error);
            let id: bigint | undefined;
            for (const log of out.receipt?.logs ?? []) {
                try {
                    const ev = decodeEventLog({ abi: levelNftAbi, data: log.data, topics: log.topics });
                    if (ev.eventName === 'LevelPublished') id = (ev.args as { id?: bigint }).id;
                } catch {
                    /* other contract's log */
                }
            }
            // A mined transaction is not a minted level: a call to an address without code (wrong network or
            // contract address) also succeeds, but emits nothing.
            if (id === undefined) throw new Error('The transaction was mined but no level was minted. Check that your wallet is on the network this app targets and that the contract address is right.');
            mark(3, 'done', `Minted level #${id}`);
            setMinted({ id, hash: out.hash });
        } catch (e) {
            mark(i, 'error', humanizeError(e));
            setError(humanizeError(e));
        } finally {
            setRunning(false);
        }
    }

    const signing = running && states[3] === 'active' && tx.stage === 'signing';

    return (
        <Modal
            open
            onClose={onClose}
            dismissible={!running}
            size="lg"
            title="Publish level"
            description={minted ? 'Your level is an ERC-721 NFT now.' : 'Ready to forge your level NFT'}
            className="publish-modal"
            footer={
                minted ? (
                    <>
                        <Button onClick={onClose}>Back to editor</Button>
                        {minted.id !== undefined && (
                            <Button to={`/level/${minted.id}`} variant="primary" icon={<ExtIcon size={16} aria-hidden />}>
                                Open level #{String(minted.id)}
                            </Button>
                        )}
                    </>
                ) : (
                    <>
                        <Button onClick={onClose} disabled={running}>
                            Cancel
                        </Button>
                        <Button variant="gold" size="lg" icon={<Rocket size={17} aria-hidden />} loading={running} disabled={!ready} onClick={() => void run()}>
                            {running ? 'Publishing…' : error ? 'Retry publish' : 'Publish'}
                        </Button>
                    </>
                )
            }
        >
            <div className="publish-grid">
                <div className="publish-form">
                    <div className="publish-thumb">{thumb ? <img src={ipfsToHttp(thumb)} alt="Level thumbnail preview" /> : <Spinner label="Capturing thumbnail" />}</div>
                    <Field label="Name" htmlFor="pub-name" error={nameError}>
                        <Input id="pub-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} disabled={running} data-autofocus />
                    </Field>
                    <Field label="Play fee" htmlFor="pub-fee" error={feeError} hint="70% goes to the owner on every settled run (max 100).">
                        <Input id="pub-fee" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value.replace(',', '.'))} icon={<ForgeCoin size={16} />} suffix="FORGE" disabled={running} />
                    </Field>
                    <Field label="Remix of" htmlFor="pub-remix" error={remixError} hint={parentId ? `Publishes a child of #${parentId}. Its layout must differ from the parent's: each layout can only be minted once.` : 'Optional parent level id; its creator shares your resale royalty.'}>
                        <Input id="pub-remix" placeholder="#12" value={remixOf} onChange={(e) => setRemixOf(e.target.value)} disabled={running} />
                    </Field>
                </div>

                <div className="publish-side">
                    {!started && !minted ? (
                        <>
                            <h3 className="mini-title">Before you publish</h3>
                            <ul className="checklist">
                                <Check
                                    ok={cleared}
                                    action={
                                        <Button size="sm" icon={<Play size={13} aria-hidden />} onClick={onTestPlay}>
                                            Test play
                                        </Button>
                                    }
                                >
                                    {cleared ? `Cleared this layout from spawn in ${formatMs(clear!.timeMs)}` : 'Clear the current layout in test play, starting from spawn'}
                                </Check>
                                {remix.known && (
                                    <Check ok={!remix.unchanged}>
                                        {remix.unchanged ? `Change something first: the layout is identical to #${remix.parentId} ${remixSource!.name}` : `Layout differs from #${remix.parentId}, the level you remix`}
                                    </Check>
                                )}
                                <Check ok={web3.isConnected} action={undefined}>
                                    Wallet connected
                                </Check>
                                <Check ok={web3.isConnected && !web3.wrongNetwork}>Supported network</Check>
                                <Check ok={web3.contractsReady}>LevelNFT deployed on this network</Check>
                                <Check ok={svc.api === 'online'}>{svc.api === 'checking' ? 'Checking game server…' : 'Game server online (pins to IPFS, signs the clear proof)'}</Check>
                            </ul>
                            <BlockerNotice compact />
                        </>
                    ) : null}
                    {(started || minted) && (
                        <ol className="steps steps-rail" aria-label="Publish progress">
                            {STEPS.map((s, i) => (
                                <li key={s.title} className={cx('step', `step-${states[i]}`)} aria-current={states[i] === 'active' ? 'step' : undefined}>
                                    <span className="step-num" aria-hidden>
                                        {states[i] === 'done' ? <CheckCircle2 size={18} /> : states[i] === 'error' ? <XCircle size={18} /> : states[i] === 'active' ? <span className="step-spinner" /> : <Circle size={18} />}
                                    </span>
                                    <div>
                                        <b>
                                            {i + 1}. {s.title}
                                        </b>
                                        <span>{notes[i]}</span>
                                    </div>
                                </li>
                            ))}
                        </ol>
                    )}
                    <p className="hash-line" title={hash}>
                        layoutHash {shortAddr(hash, 10, 8)}
                    </p>
                </div>
            </div>
            {signing && (
                <div className="wallet-wait" role="status">
                    <Spinner size={20} label="Waiting for wallet" />
                    <div>
                        <b>Confirm in your wallet</b>
                        <span>Approve the transaction in your wallet to mint your LevelNFT.</span>
                    </div>
                    <Wallet size={18} aria-hidden />
                </div>
            )}
            {error && (
                <div className="notice notice-error" role="alert">
                    {error}
                </div>
            )}
            {minted && (
                <div className="notice notice-success" role="status">
                    <CheckCircle2 size={16} aria-hidden />
                    <span>
                        Published. Players can find it in <Link to="/browse?sort=new">Browse → New</Link> once the indexer picks up the event.
                    </span>
                </div>
            )}
        </Modal>
    );
}
