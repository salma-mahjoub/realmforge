import { describe, expect, it } from 'vitest';
import { ELEMENT_TYPES, normalizeProps } from '@realmforge/game-core';
import sample from '../level/samples/seesaw-hell.level.v1.json';
import { canonicalType, footprint, sanitizeProps, terrainDef, toCoreDef } from './bridge';
import { ELEMENTS, ELEMENT_BY_TYPE } from '../level/catalog';
import type { LevelFileV1 } from '../level/types';

describe('web level → game-core element defs', () => {
    it('catalog covers every game-core element with its prop descriptors', () => {
        expect(ELEMENTS.map((e) => e.type)).toEqual([...ELEMENT_TYPES]);
        expect(ELEMENT_BY_TYPE.moving_platform.props.map((p) => p.key)).toContain('path');
        expect(ELEMENT_BY_TYPE.door.props.find((p) => p.key === 'link')?.kind).toBe('link');
    });

    it('every sample entity converts to a def game-core accepts', () => {
        for (const e of (sample as LevelFileV1).entities) {
            const def = toCoreDef(e);
            expect(def, e.type).not.toBeNull();
            expect(() => normalizeProps(def!.type, def!.props)).not.toThrow();
        }
    });

    it('maps legacy names and coerces legacy props', () => {
        expect(canonicalType('pendulum')).toBe('pendulum_ball');
        expect(canonicalType('nope')).toBeNull();
        const p = sanitizeProps('walker', { speed: 60, direction: 'left', bogus: 1 });
        expect(p).toEqual({ speed: 32, direction: -1 });
        expect(() => normalizeProps('walker', p)).not.toThrow();
    });

    it('anchors bottom-left tiles to game-core tile-space centres', () => {
        expect(toCoreDef({ id: 1, type: 'coin', x: 4, y: 10 })).toMatchObject({ x: 4.5, y: 10.5 });
        expect(toCoreDef({ id: 2, type: 'moving_platform', x: 4, y: 10, props: { width: 3 } })).toMatchObject({ x: 5.5, y: 10.5 });
        expect(footprint('seesaw', { length: 6 })).toEqual({ w: 6, h: 1 });
        expect(terrainDef('brick', 3, 7)).toMatchObject({ id: 't:3:7', x: 3.5, y: 7.5 });
    });
});
