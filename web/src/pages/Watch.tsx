import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, UserRound } from 'lucide-react';
import { api } from '../api/client';
import { RaceConnection, closeRoom, colorFor, openRoom } from '../api/colyseus';
import type { RemotePlayerState } from '../game/EventBus';
import { EventBus } from '../game/EventBus';
import { PhaserGame } from '../game/PhaserGame';
import { SCENES } from '../game/constants';
import type { LevelFileV1 } from '../game/level/types';
import { Button, Card, Pill, Skeleton, shortAddr } from '../components/ui';

const WATCH_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export default function Watch() {
    const code = (useParams().code ?? '').toUpperCase();
    const [conn, setConn] = useState<RaceConnection | null>(null);
    const [players, setPlayers] = useState<RemotePlayerState[]>([]);
    const [level, setLevel] = useState<LevelFileV1 | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const selectedRef = useRef<string | null>(null);
    const loadedLevel = useRef<string | null>(null);
    selectedRef.current = selected;

    useEffect(() => {
        const key = `spectator:${code}`;
        let cancelled = false;
        openRoom(key, code, () => RaceConnection.joinByCode(code, { address: WATCH_ADDRESS, levelId: 0, spectator: true }))
            .then((c) => {
                if (cancelled) return;
                setConn(c);
                const update = (state: NonNullable<typeof c.room.state>) => {
                    const list: RemotePlayerState[] = [];
                    state.players?.forEach((p, sessionId) => list.push({
                        sessionId,
                        address: p.address ?? '0x',
                        color: colorFor(list.length),
                        x: p.x ?? 0, y: p.y ?? 0, vx: p.vx ?? 0, vy: p.vy ?? 0,
                        finished: Boolean((p as { finished?: boolean }).finished),
                        finishTimeMs: Number((p as { finishTimeMs?: number }).finishTimeMs) || undefined,
                    }));
                    setPlayers(list);
                    if (list.length && (!selectedRef.current || !list.some((p) => p.sessionId === selectedRef.current))) { selectedRef.current = list[0].sessionId; setSelected(list[0].sessionId); }
                    const levelId = Number(state.levelId);
                    if (Number.isFinite(levelId) && levelId > 0 && loadedLevel.current !== String(levelId)) {
                        loadedLevel.current = String(levelId);
                        void api.getLevelFile(levelId).then((file) => !cancelled && setLevel(file));
                    }
                };
                c.attachToScene();
                c.room.onStateChange(update);
                if (c.room.state) update(c.room.state);
            })
            .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); });
        return () => { cancelled = true; setConn(null); closeRoom(key); };
    }, [code]);

    useEffect(() => { if (selected) EventBus.emit('watch:follow', selected); }, [selected]);
    useEffect(() => EventBus.subscribe('current-scene-ready', (scene) => {
        if (scene.scene.key === SCENES.Spectate && selectedRef.current) EventBus.emit('watch:follow', selectedRef.current);
    }), []);

    const ranking = useMemo(() => [...players].sort((a, b) => Number(b.finished) - Number(a.finished) || (a.finished ? (a.finishTimeMs ?? Infinity) - (b.finishTimeMs ?? Infinity) : b.x - a.x)), [players]);
    const levelId = conn?.room.state?.levelId;

    return <div className="page page-watch">
        <header className="race-head"><div className="row"><h1 className="page-title">Watch race</h1><Pill tone={error ? 'red' : conn ? 'green' : 'amber'} pulse={!error}>{error ? 'Offline' : conn ? 'LIVE' : 'Connecting'}</Pill></div><span className="fine">Room {code} · read-only spectator</span></header>
        {error ? <Card><p role="alert">Could not join this race: {error}</p><Button to="/browse">Browse levels</Button></Card> : <div className="watch-layout">
            <Card className="watch-ranking"><h2 className="card-title"><Eye size={17} /> Live ranking</h2><ol>{ranking.map((p, i) => <li key={p.sessionId} className={selected === p.sessionId ? 'is-following' : ''}><button type="button" onClick={() => setSelected(p.sessionId)} aria-pressed={selected === p.sessionId}><span className="rank-n">{i + 1}</span><span className="pcolor" style={{ background: `#${p.color.toString(16).padStart(6, '0')}` }} /><span>{shortAddr(p.address, 4, 3)}</span><span className="fine">{p.finished ? 'Finished' : `${Math.floor(p.x)} tiles`}</span></button></li>)}</ol><p className="fine"><UserRound size={14} /> {conn?.room.state?.spectatorCount ?? 0} spectators</p></Card>
            <Card className="watch-stage" pad={false}><div className="race-stage-head"><h2 className="card-title">{level?.meta.name ?? (levelId ? `Level #${levelId}` : 'Loading race…')}</h2><Button size="sm" variant="secondary" onClick={() => selected && EventBus.emit('watch:follow', selected)} disabled={!selected}>Follow selected</Button></div><div className="play-stage race-stage">{level ? <PhaserGame key={`${code}:${levelId}`} scene={SCENES.Spectate} data={{ level, levelId: levelId ?? null, from: 'race', roomCode: code, spectator: true, skipIntro: true }} /> : <div className="stage-loading"><Skeleton w="100%" h="100%" r={0} /></div>}</div></Card>
        </div>}
        <Button to={`/room/${code}`} variant="ghost">Open race lobby</Button>
        {conn && <span className="sr-only" aria-live="polite">Connected as spectator</span>}
    </div>;
}
