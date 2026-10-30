import { Client, type Room } from 'colyseus.js';
import type { Address } from 'viem';
import { EventBus, type RemotePlayerState } from '../game/EventBus';

/**
 * Colyseus client (SPEC §3.5/§3.6), aligned with server/src/game.ts + rooms/BaseMatchRoom.ts:
 * rooms `race` (versus) / `coop`; client → server messages `ready`, `pos` {f,x,y,vx,vy} (tiles),
 * `checkpoint` {id}, `coin` {count}, `finish`; server → client `countdown`, `start`, `finished`,
 * `result`. Player positions in the synced state are tiles.
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
    /** Display name (≤ 24 chars). */
    name?: string;
    /** Optional personal_sign of `RealmForge: join room <roomId> as <address>` (server joinMessage). */
    signature?: string;
    /** bytes32 race id from ForgeCoin.createRaceRoom (derived from the room id when omitted). */
    raceId?: string;
    minPlayers?: number;
    /** FORGE stake (decimal string) — escrow happens on-chain (createRaceRoom/joinRace), not in the room. */
    stake?: string;
}

const PALETTE = [0x22d3ee, 0xf472b6, 0xa3e635, 0xfbbf24];
const colorFor = (sessionId: string) => PALETTE[[...sessionId].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

/** Shape the client expects from the server's room state (schema classes on the server). */
export interface RaceStateLike {
    phase?: string;
    levelId?: string;
    raceId?: string;
    startAt?: number;
    elapsedMs?: number;
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
                    color: colorFor(sessionId),
                    x: p.x ?? 0,
                    y: p.y ?? 0,
                    vx: p.vx ?? 0,
                    vy: p.vy ?? 0,
                    anim: p.anim,
                });
            });
            EventBus.emit('race:remote-states', players);
        });
        this.unsub.push(EventBus.subscribe('race:local-state', (s) => this.room.send('pos', s)));
        this.unsub.push(EventBus.subscribe('race:checkpoint', (c) => this.room.send('checkpoint', c)));
        this.unsub.push(EventBus.subscribe('race:coins', (count) => this.room.send('coin', { count })));
        this.unsub.push(EventBus.subscribe('play:finished', () => this.room.send('finish')));
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
