import type Phaser from 'phaser';

/** Fractions of the configured height; entity x/y remains the axle center. */
export const SEESAW = Object.freeze({ thickness: 0.45, legacyThickness: 0.25, maxAngle: Math.PI / 6 });

/** Keep the old plank's weight and rotational response despite its deeper collision deck. */
export function configureSeesaw(scene: Phaser.Scene, body: MatterJS.BodyType, width: number, height: number) {
    const oldHeight = height * SEESAW.legacyThickness;
    const newHeight = height * SEESAW.thickness;
    const B = scene.matter.body, world = scene.matter.world;
    B.setMass(body, body.mass * oldHeight / newHeight);
    B.setInertia(body, body.inertia * (width * width + oldHeight * oldHeight) / (width * width + newHeight * newHeight));

    // A center pin alone permits full rotations. Limit travel without a restoring motor,
    // damping inward motion or changing the controller's velocity / foot sensors.
    const limit = () => {
        const angle = Math.max(-SEESAW.maxAngle, Math.min(SEESAW.maxAngle, body.angle));
        if (angle !== body.angle) B.setAngle(body, angle);
        if ((angle >= SEESAW.maxAngle && body.angularVelocity > 0) || (angle <= -SEESAW.maxAngle && body.angularVelocity < 0)) B.setAngularVelocity(body, 0);
    };
    // Bound the completed physics step as well as externally restored angles.
    world.on('beforeupdate', limit);
    world.on('afterupdate', limit);
    return () => {
        world.off('beforeupdate', limit);
        world.off('afterupdate', limit);
    };
}
