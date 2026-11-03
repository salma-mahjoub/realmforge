import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RaceConnection, closeRoom, openRoom, stashConnection } from './colyseus';

// the real bus pulls in Phaser, which needs a browser
vi.mock('../game/EventBus', () => ({ EventBus: { subscribe: vi.fn(() => () => undefined), emit: vi.fn() } }));

const fake = (code: string) => {
    const leave = vi.fn(async () => undefined);
    return { conn: { code, leave } as unknown as RaceConnection, leave };
};

describe('openRoom / closeRoom (React StrictMode runs the lobby effect twice)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('keeps a handed-over room alive across the cleanup of the first effect run', async () => {
        const { conn, leave } = fake('AB2C');
        stashConnection(conn);
        const join = vi.fn();

        const first = await openRoom('AB2C:0x1', 'AB2C', join); // first run takes the host's connection
        closeRoom('AB2C:0x1'); // its cleanup
        const second = await openRoom('AB2C:0x1', 'AB2C', join); // second run, immediately

        expect(second).toBe(first);
        expect(join).not.toHaveBeenCalled(); // no "room not found" join attempt
        await vi.advanceTimersByTimeAsync(1000);
        expect(leave).not.toHaveBeenCalled();
    });

    it('leaves the room once the page is really closed', async () => {
        const { conn, leave } = fake('ZZ99');
        stashConnection(conn);
        await openRoom('ZZ99:0x1', 'ZZ99', vi.fn());
        closeRoom('ZZ99:0x1');
        await vi.advanceTimersByTimeAsync(1000);
        expect(leave).toHaveBeenCalledTimes(1);
    });

    it('joins by code when nothing was handed over, and shares that join', async () => {
        const { conn } = fake('JN3K');
        const join = vi.fn(async () => conn);
        const [a, b] = await Promise.all([openRoom('JN3K:0x2', 'JN3K', join), openRoom('JN3K:0x2', 'JN3K', join)]);
        expect(a).toBe(b);
        expect(join).toHaveBeenCalledTimes(1);
        closeRoom('JN3K:0x2');
        await vi.advanceTimersByTimeAsync(1000);
    });
});
