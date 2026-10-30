/**
 * Run recording (SPEC §3.6): game-core replay bitmask log + the position trace / checkpoint hits
 * the server's plausibility checks expect (`server/src/validation/types.ts` → `RunSubmission`).
 */
import { decodeInput, encodeInput, type InputState, type Replay } from '@realmforge/game-core';

/** One position sample: fixed-step frame (60 Hz) and position in tiles (cell coordinates, like level spawn/goal). */
export interface TraceSample {
    f: number;
    x: number;
    y: number;
}

/** Body of `run` in POST /levels/clear-proof and POST /runs/validate. */
export interface RunSubmission {
    timeMs: number;
    cleared: boolean;
    coins: number;
    trace: TraceSample[];
    checkpoints: { id: number; f: number }[];
    /** base64(JSON `{ v: 1, log: [[frame, mask], …] }`) — compact game-core input masks (change points only). */
    inputLog?: string;
}

/** Sample the position every N fixed frames (the server checks speed per tick across any stride). */
export const TRACE_STRIDE = 4;

/** Replay (one mask per frame) → `[frame, buttons]` change pairs. */
export function changePairs(replay: Replay): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let last = -1;
    replay.inputs.forEach((mask, f) => {
        if (mask !== last) out.push([f, mask]);
        last = mask;
    });
    return out;
}

/** `[frame, buttons]` change pairs → per-frame game-core Replay of `frames` length. */
export function expandPairs(pairs: Array<[number, number]>, frames: number): Replay {
    const inputs: number[] = [];
    let i = 0;
    let mask = 0;
    for (let f = 0; f < frames; f++) {
        while (i < pairs.length && pairs[i][0] <= f) mask = pairs[i++][1];
        inputs.push(encodeInput(decodeInput(mask)));
    }
    return { version: 1, inputs };
}

export function encodeInputLog(replay: Replay): string {
    const json = JSON.stringify({ v: 1, frames: replay.inputs.length, log: changePairs(replay) });
    return btoa(json);
}

export function decodeInputLog(b64: string): Replay {
    const parsed = JSON.parse(atob(b64)) as { v: number; frames: number; log: Array<[number, number]> };
    if (parsed.v !== 1) throw new Error('unsupported input log version');
    return expandPairs(parsed.log, parsed.frames);
}

export type { InputState };
