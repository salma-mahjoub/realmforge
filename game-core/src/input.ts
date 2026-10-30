export interface InputState { left: boolean; right: boolean; up: boolean; down: boolean; jump: boolean; run: boolean }
export interface InputEdges extends InputState { jumpPressed: boolean; jumpReleased: boolean }
export const EMPTY_INPUT: Readonly<InputState> = Object.freeze({left:false,right:false,up:false,down:false,jump:false,run:false});
const KEYS = ['left','right','up','down','jump','run'] as const;
export function encodeInput(input: InputState): number { return KEYS.reduce((mask,key,i) => mask | (input[key] ? 1 << i : 0), 0); }
export function decodeInput(mask: number): InputState {
  if (!Number.isInteger(mask) || mask < 0 || mask > 63) throw new RangeError('Input mask must be an integer in [0, 63]');
  return {left:!!(mask&1),right:!!(mask&2),up:!!(mask&4),down:!!(mask&8),jump:!!(mask&16),run:!!(mask&32)};
}
export function inputEdges(input: InputState, previous: InputState = EMPTY_INPUT): InputEdges {
  return {...input,jumpPressed: input.jump && !previous.jump,jumpReleased: !input.jump && previous.jump};
}
