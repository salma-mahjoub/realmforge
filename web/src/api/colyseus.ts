import { Client, type Room } from 'colyseus.js';
import type { Address } from 'viem';
import { EventBus, type RemotePlayerState } from '../game/EventBus';

/**
 * Colyseus client (SPEC §3.5/§3.6). Room/message names are provisional until server/ freezes
 * them: room `race` (versus) / `coop`, messages `input`, `state`, `ready`, `finish`.
 */
export const GAME_SERVER_URL = import.meta.env.VITE_GAME_SERVER_URL || 'ws://localhost:2567';

let client: Client | null = null;
export function getGameClient(): Client {
    client ??= new Client(GAME_SERVER_URL);
    return client;
}

export type RoomKind = 'race' | 'coop';

export interface JoinOptions {
    address: Address;
    levelId: number;
    /** FORGE stake (decimal string), escrowed on-chain via ForgeCoin.createRaceRoom/joinRace */
    stake?: string;
}

/** Shape the client expects from the server's room state (schema classes on the server). */
export interface RaceStateLike {
    phase?: string;
    levelId?: number;
    startedAt?: number;
    players?: { forEach(cb: (p: Partial<RemotePlayerState>, sessionId: string) => void): void };
}

export class RaceConnection {
    private unsub: Array<() => void> = [];

    private constructor(readonly room: Room<RaceStateLike>) {}

    static async create(kind: RoomKind, opts: JoinOptions) {
        return new RaceConnection(await getGameClient().create<RaceStateLike>(kind, opts));
    }

    static async joinByCode(code: string, opts: JoinOptions) {
        return new RaceConnection(await getGameClient().joinById<RaceStateLike>(code, opts));
    }

    get code() {
        return this.room.roomId;
    }

    /** Bridge server state → RaceScene and local state → server. */
    attachToScene() {
        this.room.onStateChange((state) => {
            const players: RemotePlayerState[] = [];
            state.players?.forEach((p, sessionId) => {
                if (sessionId === this.room.sessionId) return;
                players.push({
                    sessionId,
                    address: p.address ?? '0x',
                    color: p.color ?? 0x22d3ee,
                    x: p.x ?? 0,
                    y: p.y ?? 0,
                    vx: p.vx ?? 0,
                    vy: p.vy ?? 0,
                    anim: p.anim,
                });
            });
            EventBus.emit('race:remote-states', players);
        });
        this.unsub.push(EventBus.subscribe('race:local-state', (s) => this.room.send('state', s)));
        this.unsub.push(EventBus.subscribe('play:finished', (r) => this.room.send('finish', { timeMs: r.timeMs, inputs: r.inputs })));
    }

    ready() {
        this.room.send('ready');
    }

    async leave() {
        this.unsub.forEach((u) => u());
        this.unsub = [];
        await this.room.leave(true);
    }
}
