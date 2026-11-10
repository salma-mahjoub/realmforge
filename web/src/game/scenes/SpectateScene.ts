import { SCENES } from '../constants';
import { RaceScene } from './RaceScene';

/** Read-only race view. RaceScene supplies the shared map and remote interpolation; it disables local input and follows the leader. */
export class SpectateScene extends RaceScene {
    constructor() { super(SCENES.Spectate); }
}
