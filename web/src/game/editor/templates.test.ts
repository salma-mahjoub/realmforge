import { describe, expect, it } from 'vitest';
import { decodeLevel } from '../level/serialize';
import { createTemplate, isAvailableMusic, LEVEL_TEMPLATES, validatedMusic } from './templates';

describe('editor templates and music choices', () => {
    it('produces valid, named, playable level.v1 documents for each starter template', () => {
        for (const template of LEVEL_TEMPLATES) {
            const file = createTemplate(template.id);
            const doc = decodeLevel(file);
            expect(file.meta.name).toBe(template.label);
            expect(doc.entities.some((e) => e.type === 'start')).toBe(true);
            expect(doc.entities.some((e) => e.type === 'goal')).toBe(true);
            expect(isAvailableMusic(file.meta.music)).toBe(true);
        }
        expect(decodeLevel(createTemplate('staircase')).terrain.some((tile) => tile === 1)).toBe(true);
        expect(decodeLevel(createTemplate('castle-gauntlet')).entities.some((e) => e.type === 'saw')).toBe(true);
    });

    it('only accepts tracks present in the asset manifests', () => {
        expect(isAvailableMusic('snow_01')).toBe(true);
        expect(isAvailableMusic('desert_01')).toBe(false);
        expect(validatedMusic('castle', 'missing_track')).toBe('castle_01');
    });
});
