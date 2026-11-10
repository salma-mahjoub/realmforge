import { Client, type Room } from 'colyseus.js';
import type { Address } from 'viem';
import { EventBus, type RemotePlayerState } from '../game/EventBus';
import { humanizeError, isUserRejection } from '../web3/errors';
import type { SessionProvider } from '../web3/siwe';

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
    /** SIWE session token (POST /auth/verify). Rooms require it or `signature`. Filled in from the SessionProvider. */
    token?: string;
    /** Alternative ownership proof: personal_sign of `RealmForge: join room <roomId> as <address>` (server joinMessage). */
    signature?: string;
    /** bytes32 race id from ForgeCoin.createRaceRoom (derived from the room id when omitted). */
    raceId?: string;
    minPlayers?: number;
    /** Room capacity (1–4); a co-op room sets it to the team size. */
    maxPlayers?: number;
    /** FORGE stake (decimal string) — escrow happens on-chain (createRaceRoom/joinRace), not in the room. */
    stake?: string;
}

/** Server code (BaseMatchRoom AUTH_ERROR) for a missing or invalid wallet ownership proof. */
export const ROOM_AUTH_ERROR = 4401;
export const isRoomAuthError = (e: unknown) => (e as { code?: number } | null)?.code === ROOM_AUTH_ERROR;

/** True when a join failed for lack of a wallet signature (refused, or refused by the server): the UI offers to sign again. */
export const needsSignIn = (e: unknown) => isRoomAuthError(e) || isUserRejection(humanizeError(e));

/** One sentence for a failed room join, explaining the sign-in requirement instead of a raw code. */
export function describeJoinError(e: unknown): string {
    if (isRoomAuthError(e)) return `Rooms only accept players who prove they own their wallet (${(e as Error).message}). Sign the free sign-in message and try again.`;
    const text = humanizeError(e);
    if (isUserRejection(text)) return 'You declined the sign-in signature. Rooms need it to prove that you own this wallet: it is free and sends no transaction.';
    return text;
}

/** Joins with a session token; if the server refuses that token (expired, server restarted), signs in again once. */
async function withSession<T>(opts: JoinOptions, auth: SessionProvider | undefined, join: (o: JoinOptions) => Promise<T>): Promise<T> {
    if (!auth) return join(opts);
    try {
        return await join({ ...opts, token: await auth.token() });
    } catch (e) {
        if (!isRoomAuthError(e)) throw e;
        return join({ ...opts, token: await auth.renew() });
    }
}

const PALETTE = [0x22d3ee, 0xf472b6, 0xa3e635, 0xfbbf24];
/**
 * Racer colour by join slot (the room's player map keeps join order, the same on every client), so up to
 * 4 players never share a colour. A hash of the session id collided often with only 4 colours.
 */
export const colorFor = (slot: number) => PALETTE[((slot % PALETTE.length) + PALETTE.length) % PALETTE.length];

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
    /** The lobby registered its room listeners on this connection (they must be added only once). */
    bound = false;

    private constructor(readonly room: Room<RaceStateLike>) {}

    static async create(kind: RoomKind, opts: JoinOptions, auth?: SessionProvider) {
        return new RaceConnection(await withSession(opts, auth, (o) => getGameClient().create<RaceStateLike>(kind, o)));
    }

    static async joinByCode(code: string, opts: JoinOptions, auth?: SessionProvider) {
        return new RaceConnection(await withSession(opts, auth, (o) => getGameClient().joinById<RaceStateLike>(code, o)));
    }

    get code() {
        return this.room.roomId;
    }

    /** Bridge server state → RaceScene and local state → server. */
    attachToScene() {
        this.room.onStateChange((state) => {
            const players: RemotePlayerState[] = [];
            let slot = 0;
            state.players?.forEach((p, sessionId) => {
                const mySlot = slot++;
                if (sessionId === this.room.sessionId) return;
                players.push({
                    sessionId,
                    address: p.address ?? '0x',
                    color: colorFor(mySlot),
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
        this.unsub.push(EventBus.subscribe('race:respawn', () => this.room.send('respawn')));
        this.unsub.push(EventBus.subscribe('race:coins', (count) => this.room.send('coin', { count })));
        this.unsub.push(EventBus.subscribe('play:finished', () => this.room.send('finish')));
    }

    ready() {
        this.room.send('ready');
    }

    /** Abandon the race: it stops waiting for this player, who is then ranked by progress. */
    giveUp() {
        this.room.send('giveup');
    }

    async leave() {
        this.unsub.forEach((u) => u());
        this.unsub = [];
        await this.room.leave(true);
    }
}

/**
 * A room created on the "new race" page must stay alive while the player moves to the lobby page (Colyseus
 * disposes an empty room), so the connection is handed over instead of being closed and re-opened.
 */
let handoff: RaceConnection | null = null;
export function stashConnection(conn: RaceConnection) {
    void handoff?.leave();
    handoff = conn;
}
export function takeConnection(code: string): RaceConnection | null {
    const conn = handoff && handoff.code === code ? handoff : null;
    if (conn) handoff = null;
    return conn;
}

interface Session {
    conn: Promise<RaceConnection>;
    timer?: ReturnType<typeof setTimeout>;
}
const sessions = new Map<string, Session>();

/**
 * One connection per room and wallet, shared across React's double effect run (StrictMode mounts, cleans up and
 * mounts again). Leaving the room on that first cleanup destroyed the host's freshly created room, and the second
 * run then failed with `room "XXXX" not found`.
 */
export function openRoom(key: string, code: string, join: () => Promise<RaceConnection>): Promise<RaceConnection> {
    const existing = sessions.get(key);
    if (existing) {
        clearTimeout(existing.timer);
        existing.timer = undefined;
        return existing.conn;
    }
    const handed = takeConnection(code);
    const conn = handed ? Promise.resolve(handed) : join();
    sessions.set(key, { conn });
    conn.catch(() => sessions.delete(key));
    return conn;
}

/** Leaves the room shortly after the page is closed, unless the page reopens it at once (the second effect run). */
export function closeRoom(key: string) {
    const session = sessions.get(key);
    if (!session) return;
    session.timer = setTimeout(() => {
        sessions.delete(key);
        void session.conn.then((c) => c.leave()).catch(() => undefined);
    }, 400);
}
