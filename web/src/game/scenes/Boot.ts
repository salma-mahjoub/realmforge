import Phaser from 'phaser';
import { SCENES } from '../constants';

/** First scene: nothing heavy here, just hand off to the Preloader (template-react-ts pattern). */
export class Boot extends Phaser.Scene {
    constructor() {
        super(SCENES.Boot);
    }

    create() {
        this.scene.start(SCENES.Preloader);
    }
}
