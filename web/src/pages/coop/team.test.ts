import { describe, expect, it } from 'vitest';
import { orderedCheckpoints, parseCoopResult, reachedCheckpointIds, respawnPoint, teamSummary } from './team';

const entities = [
    { id: 1, type: 'start', x: 1, y: 8 },
    { id: 7, type: 'checkpoint', x: 30, y: 6 },
    { id: 5, type: 'checkpoint', x: 12, y: 8 },
    { id: 9, type: 'checkpoint', x: 50, y: 4, props: { order: 0 } },
    { id: 3, type: 'coin', x: 13, y: 5 },
];
const spawn = { x: 1, y: 8 };

describe('co-op checkpoints', () => {
    it('orders checkpoints like the server (props.order, then x)', () => {
        expect(orderedCheckpoints(entities).map((e) => e.id)).toEqual([9, 5, 7]);
    });

    it('respawns at the furthest shared checkpoint, or at spawn when none was reached', () => {
        expect(respawnPoint(entities, -1, spawn)).toEqual(spawn);
        expect(respawnPoint(entities, 1, spawn)).toEqual({ x: 12, y: 8 });
        expect(respawnPoint(entities, 2, spawn)).toEqual({ x: 30, y: 6 });
        expect(respawnPoint(entities, 9, spawn)).toEqual(spawn); // unknown index: never a made-up point
    });

    it('counts a teammate’s checkpoints as reached', () => {
        expect([...reachedCheckpointIds(entities, -1, [5])].sort()).toEqual([5]);
        expect([...reachedCheckpointIds(entities, 1, [])].sort()).toEqual([5, 9]);
        expect([...reachedCheckpointIds(entities, 2, [])].sort()).toEqual([5, 7, 9]);
    });
});

describe('teamSummary', () => {
    it('team time is the last finisher, combined is the sum', () => {
        const s = teamSummary([
            { address: '0xa', finished: true, finishTimeMs: 12_000 },
            { address: '0xb', finished: true, finishTimeMs: 15_500 },
        ]);
        expect(s).toEqual({ cleared: true, teamTimeMs: 15_500, combinedMs: 27_500, finishers: 2, total: 2 });
    });

    it('is not cleared while a connected teammate has not finished (a quitter holds the team back)', () => {
        const s = teamSummary([
            { address: '0xa', finished: true, finishTimeMs: 12_000 },
            { address: '0xb', finished: false, finishTimeMs: 0, gaveUp: true },
        ]);
        expect(s.cleared).toBe(false);
        expect(s.teamTimeMs).toBeNull();
        expect(s.combinedMs).toBe(12_000);
    });

    it('a disconnected teammate does not block the clear', () => {
        expect(teamSummary([{ address: '0xa', finished: true, finishTimeMs: 9_000 }, { address: '0xb', finished: false, finishTimeMs: 0, connected: false }]).cleared).toBe(true);
        expect(teamSummary([]).cleared).toBe(false);
    });
});

describe('parseCoopResult', () => {
    it('parses a signed RunResult', () => {
        const out = parseCoopResult({
            kind: 'coop',
            result: { player: '0x90F79bf6EB2c4f870365E785982E1f101E93b906', levelId: '2', timeMs: 15500, cleared: true, coins: 3, nonce: '123', deadline: '1700000000' },
            signature: '0xabc',
            signer: '0x01',
        });
        expect(out?.cleared).toBe(true);
        expect(out?.signed?.result.levelId).toBe(2n);
        expect(out?.signed?.result.nonce).toBe(123n);
        expect(out?.signed?.signature).toBe('0xabc');
    });

    it('parses the unpublished-level and error shapes', () => {
        expect(parseCoopResult({ kind: 'coop', cleared: true, error: 'unpublished level: nothing to settle' })).toEqual({ signed: null, cleared: true, error: 'unpublished level: nothing to settle' });
        expect(parseCoopResult({ error: 'boom' })).toEqual({ signed: null, cleared: false, error: 'boom' });
        expect(parseCoopResult(null)).toBeNull();
        expect(parseCoopResult({ kind: 'race' })).toBeNull();
    });
});
