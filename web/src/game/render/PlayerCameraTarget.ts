import { TILE } from '../constants';

/** Camera-only reference: physical x and a grounded feet baseline, independent of sprite poses. */
export class PlayerCameraTarget {
    constructor(public x: number, public y: number) {}

    update(x: number, feet: number, grounded: boolean, viewHeight: number, velocityY = 0) {
        this.x = x;
        if (grounded) this.y = feet;
        else {
            // Leave headroom for ordinary jumps. Sustained climbing / falling must still scroll,
            // and a short viewport needs a smaller band so the player cannot leave the screen.
            // Anticipate six physics steps to account for follow response at high vertical speed.
            const rise = Math.max(0, Math.min(6 * TILE, viewHeight * 0.55) - Math.max(0, -velocityY) * 6);
            const fall = Math.max(0, Math.min(3 * TILE, viewHeight * 0.15) - Math.max(0, velocityY) * 6);
            this.y = Math.max(feet - fall, Math.min(this.y, feet + rise));
        }
    }
}
