/** Reference pixels/frame (60 Hz), 16 px tiles. All state uses integer 1/256 reference px. */
export const SUBPIXEL = 256;
export const FIXED_HZ = 60;
export const FIXED_MS = 1000 / FIXED_HZ;
export const MOVEMENT = Object.freeze({
  tile: 64, referenceTile: 16, scale: 4,
  walkMax: 1.5, runMax: 2.5,
  walkAcceleration: 0.037109375, runAcceleration: 0.0556640625,
  releaseFriction: 0.05078125, skidDeceleration: 0.1015625,
  airAcceleration: 0.037109375, airReverseAcceleration: 0.07421875,
  jumpSpeedThresholds: [0.5625, 1, 1.5625, 1.75] as readonly number[],
  jumpVelocity: [-4, -4, -4, -5, -5] as readonly number[],
  heldGravity: [0.125, 0.125, 0.1171875, 0.15625, 0.15625] as readonly number[],
  heavyGravity: [0.4375, 0.4375, 0.375, 0.5625, 0.5625] as readonly number[],
  maxFallSpeed: 4, coyoteFrames: 6, jumpBufferFrames: 6,
  wallSlideMax: 1, wallJumpX: 2.5, wallJumpY: -4.5, wallLockFrames: 8,
  cornerCorrection: 4, stompVelocity: -3, heldStompVelocity: -5, springVelocity: -7,
});
export const toFixed = (pixels: number): number => Math.round(pixels * SUBPIXEL);
export const fromFixed = (value: number): number => value / SUBPIXEL;
export const worldToFixed = (pixels: number, scale: number = MOVEMENT.scale): number => toFixed(pixels / scale);
export const fixedToWorld = (value: number, scale: number = MOVEMENT.scale): number => fromFixed(value) * scale;
/** SPEC names; bits are this package's integration convention, not specified by SPEC. */
export const COLLISION_CATEGORIES = Object.freeze({player: 1, enemy: 2, solid: 4, oneWay: 8, hazard: 16, pickup: 32, sensor: 64});
