import sample from './samples/seesaw-hell.level.v1.json';
import type { LevelFileV1 } from './types';

/** Bundled sample level (SPEC §3.4 format) used by placeholder pages and as editor fallback. */
export const SAMPLE_LEVEL = sample as LevelFileV1;

export const AUTOSAVE_KEY = 'realmforge:editor:autosave:v1';

export function loadAutosave(): LevelFileV1 | null {
    try {
        const raw = localStorage.getItem(AUTOSAVE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as LevelFileV1;
        return parsed.schema === 1 ? parsed : null;
    } catch {
        return null;
    }
}

export function saveAutosave(level: LevelFileV1): void {
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(level));
    } catch (err) {
        console.warn('[autosave] failed', err);
    }
}
