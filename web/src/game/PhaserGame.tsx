import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';
import StartGame, { type StartGameOptions } from './main';
import { EventBus } from './EventBus';

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

    useEffect(() => {
        return EventBus.subscribe('current-scene-ready', (s) => {
            currentActiveScene?.(s);
            if (typeof ref === 'function') ref({ game: game.current, scene: s });
            else if (ref) ref.current = { game: game.current, scene: s };
        });
    }, [currentActiveScene, ref]);

    return <div ref={container} className={className ?? 'game-container'} tabIndex={0} />;
});
