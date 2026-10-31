import Phaser from 'phaser';
import { Boot } from './scenes/Boot';
import { Preloader } from './scenes/Preloader';
import { EditorScene } from './scenes/EditorScene';
import { PlayScene } from './scenes/PlayScene';
import { RaceScene } from './scenes/RaceScene';
import { selectedPack } from './assets/pack';
import { REG, type GameSceneKey } from './constants';

export interface StartGameOptions {
    /** Scene the Preloader hands off to. */
    scene: GameSceneKey;
    /** Data passed to that scene's init(). */
    data?: object;
}

/**
 * Game factory (template-react-ts `StartGame`, extended). One Phaser.Game per mounted
 * <PhaserGame/>. Matter physics is configured per scene (PlayScene/RaceScene) with a fixed
 * 60 Hz step (SPEC §3.1); the EditorScene runs without physics.
 */
export default function StartGame(parent: string | HTMLElement, opts: StartGameOptions): Phaser.Game {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent,
        backgroundColor: '#0f1424',
        scale: {
            mode: Phaser.Scale.RESIZE,
            width: '100%',
            height: '100%',
        },
        fps: { target: 60, smoothStep: false },
        render: { pixelArt: selectedPack() === 'mario', antialias: selectedPack() !== 'mario', preserveDrawingBuffer: true },
        input: { keyboard: true, mouse: true, touch: true },
        scene: [Boot, Preloader, EditorScene, PlayScene, RaceScene],
        callbacks: {
            preBoot: (game) => {
                game.registry.set(REG.startScene, opts.scene);
                game.registry.set(REG.startData, opts.data ?? {});
            },
        },
    };
    return new Phaser.Game(config);
}
