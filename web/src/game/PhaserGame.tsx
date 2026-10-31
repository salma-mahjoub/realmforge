import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import StartGame, { type StartGameOptions } from './main';
import { EventBus } from './EventBus';
import { PACK_STORAGE_KEY, selectedPack, type AssetPack } from './assets/pack';

/**
 * React host for the Phaser canvas — adapted from phaserjs/template-react-ts (MIT).
 * Creates one game on mount, destroys it on unmount, and exposes the active scene via ref.
 */
export interface IRefPhaserGame {
    game: Phaser.Game | null;
    scene: Phaser.Scene | null;
}

interface Props extends StartGameOptions {
    className?: string;
    currentActiveScene?: (scene: Phaser.Scene) => void;
}

export const PhaserGame = forwardRef<IRefPhaserGame, Props>(function PhaserGame({ scene, data, className, currentActiveScene }, ref) {
    const [pack, setPack] = useState<AssetPack>(selectedPack);
    const [loadedPack, setLoadedPack] = useState<string>();
    const container = useRef<HTMLDivElement>(null);
    const game = useRef<Phaser.Game | null>(null);
    // start options are read once at mount; later changes go through the EventBus
    const opts = useRef<StartGameOptions>({ scene, data });

    useLayoutEffect(() => {
        if (!container.current || game.current) return;
        game.current = StartGame(container.current, opts.current);
        if (import.meta.env.DEV) (window as unknown as { __rfGame?: Phaser.Game }).__rfGame = game.current;
        if (typeof ref === 'function') ref({ game: game.current, scene: null });
        else if (ref) ref.current = { game: game.current, scene: null };

        return () => {
            game.current?.destroy(true);
            game.current = null;
        };
    }, [ref]);

    useEffect(() => EventBus.subscribe('assets-ready', (info) => setLoadedPack(info.pack)), []);

    useEffect(() => {
        return EventBus.subscribe('current-scene-ready', (s) => {
            currentActiveScene?.(s);
            if (typeof ref === 'function') ref({ game: game.current, scene: s });
            else if (ref) ref.current = { game: game.current, scene: s };
        });
    }, [currentActiveScene, ref]);

    return <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <div ref={container} className={className ?? 'game-container'} tabIndex={0} />
        <label style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 3, background: '#0f1424e6', padding: '5px 8px', border: '1px solid #7c5cff', borderRadius: 8, color: '#fff', fontSize: 12 }}>
            Art {loadedPack && loadedPack !== pack ? `(${loadedPack} fallback)` : ''} <select aria-label="Asset pack" value={pack} onChange={(e) => {
                const next = e.target.value as AssetPack;
                EventBus.emit('assets:will-change');
                try { localStorage.setItem(PACK_STORAGE_KEY, next); } catch { return; }
                setPack(next);
                window.location.reload();
            }} style={{ color: '#fff', background: '#182039', border: 0, marginLeft: 4 }}>
                <option value="mario">Mario</option><option value="kenney">Kenney</option>
            </select>
        </label>
    </div>;
});
