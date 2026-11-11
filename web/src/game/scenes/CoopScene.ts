import { EventBus } from '../EventBus';
import { SCENES } from '../constants';
import { reachedCheckpointIds, respawnPoint } from '../../pages/coop/team';
import { RaceScene, type RaceSceneData } from './RaceScene';

export interface CoopSceneData extends RaceSceneData {
    /** Furthest checkpoint index reached by anyone (server `sharedCheckpoint`, -1 = none). */
    sharedCheckpoint?: number;
}

/** Pause between the fall animation and the respawn at the team checkpoint. */
const RESPAWN_DELAY_MS = 400;

/**
 * Co-op (SPEC §3.5): the race scene's networking (local player simulated, partners interpolated from Colyseus
 * patches, 20 Hz `pos`, restart at spawn on GO) with shared checkpoints:
 * - a fall respawns the player at the furthest checkpoint anyone in the team reached (`coop:shared-checkpoint`,
 *   relayed by React from the room's `sharedCheckpoint`), after telling the room (`race:respawn`) so its frame
 *   counter starts again and it expects the next position at a checkpoint;
 * - checkpoints a teammate reached count for the flag too (the server shares them in `CoopRoom.onCheckpoint`);
 * - the team clears when everyone reaches the goal (`coop:ended`).
 */
export class CoopScene extends RaceScene {
    private shared = -1;
    private ended = false;

    constructor() {
        super(SCENES.Coop);
    }

    init(data: CoopSceneData) {
        super.init(data);
        this.shared = data?.sharedCheckpoint ?? -1;
        this.ended = false;
    }

    /** A fall (or R) respawns at the team checkpoint; GO restarts everyone at the level spawn, frame 0. */
    protected restart(raceStart = false) {
        if (raceStart) this.shared = -1; // the room only accepts checkpoints once running: nothing is shared yet
        EventBus.emit('race:respawn');
        const spawn = raceStart ? undefined : respawnPoint(this.doc.entities, this.shared, this.doc.spawn);
        this.scene.restart({
            level: this.file,
            levelId: this.levelId,
            from: 'race',
            spawn,
            creator: this.creator,
            roomCode: this.roomCode,
            skipIntro: true,
            racing: raceStart || this.racing,
            sharedCheckpoint: this.shared,
        } satisfies CoopSceneData);
    }

    protected bindBus() {
        super.bindBus();
        this.unsubs.push(EventBus.subscribe('coop:shared-checkpoint', (index) => (this.shared = Math.max(this.shared, index))));
        this.unsubs.push(
            EventBus.subscribe('play:died', () => {
                if (!this.ended) this.time.delayedCall(RESPAWN_DELAY_MS, () => this.restart());
            }),
        );
        this.unsubs.push(
            EventBus.subscribe('coop:ended', (cleared) => {
                this.ended = true;
                this.showNote(cleared ? 'TEAM CLEAR!' : 'CO-OP OVER  ·  THE TEAM DID NOT CLEAR');
            }),
        );
    }

    protected missingCheckpoints(): number {
        const reached = reachedCheckpointIds(this.doc.entities, this.shared, this.checkpointHits.map((c) => c.id));
        return this.doc.entities.filter((e) => e.type === 'checkpoint' && !reached.has(e.id)).length;
    }

    protected afterGoalWalk() {
        if (!this.ended) this.showNote('AT THE FLAG  ·  WAITING FOR YOUR TEAM');
    }
}
