import { Room, ServerError, type Client } from "@colyseus/core";
import { getAddress, isAddress, isHex, keccak256, toHex, verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
import type { LevelAnalysis } from "../level/analysis.js";
import { checkStep } from "../validation/plausibility.js";
import { PHYSICS } from "../validation/constants.js";
import { roomServices } from "./services.js";
import { MatchState, PlayerState } from "./state.js";

export const PATCH_RATE_MS = 50; // 20 Hz state patches (SPEC §3.5)
export const COUNTDOWN_MS = 3_000;
export const MAX_STRIKES = 5;
export const RECONNECT_SEC = 20;

export const createOptionsSchema = z.object({
  levelId: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).optional(),
  /** bytes32 room id from ForgeCoin.createRaceRoom (race escrow). Derived from the Colyseus roomId if omitted. */
  raceId: z.string().optional(),
  minPlayers: z.number().int().min(1).max(4).optional(),
  maxPlayers: z.number().int().min(1).max(4).optional(),
  /** Unpublished levels (dev/test only): the room cannot check checkpoints/goal. */
  timeLimitSec: z.number().int().min(10).max(3600).optional(),
});

export const joinOptionsSchema = z.object({
  address: z.string().refine((a) => isAddress(a), "invalid wallet address"),
  name: z.string().max(24).optional(),
  /** Optional personal_sign of joinMessage(roomId, address) proving wallet ownership. */
  signature: z.string().optional(),
});

const posSchema = z.object({
  f: z.number().int().nonnegative(),
  x: z.number().finite(),
  y: z.number().finite(),
  vx: z.number().finite().default(0),
  vy: z.number().finite().default(0),
});
const checkpointSchema = z.object({ id: z.number().int().nonnegative() });
const coinSchema = z.object({ count: z.number().int().min(0).max(255) });

export const joinMessage = (roomId: string, address: string) => `RealmForge: join room ${roomId} as ${address.toLowerCase()}`;

interface ClientData {
  address: Address;
}

/**
 * Shared room logic for race and co-op: wallet join, ready/countdown, server timing,
 * per-tick speed plausibility, checkpoint order, finish order and time limit.
 */
export abstract class BaseMatchRoom<S extends MatchState> extends Room<S, unknown, ClientData> {
  maxClients = 4;
  protected analysis: LevelAnalysis | null = null;
  protected ended = false;

  protected abstract createState(): S;
  protected abstract onPlayerFinished(player: PlayerState): void;
  protected abstract onCheckpoint(player: PlayerState, index: number): void;
  protected abstract settle(): Promise<void>;
  protected defaultMinPlayers = 2;

  onCreate(rawOptions: unknown) {
    const options = createOptionsSchema.parse(rawOptions ?? {});
    const state = this.createState();
    this.setState(state);
    this.setPatchRate(PATCH_RATE_MS);
    this.maxClients = options.maxPlayers ?? 4;
    state.minPlayers = Math.min(options.minPlayers ?? this.defaultMinPlayers, this.maxClients);

    const { levels } = roomServices();
    if (options.levelId !== undefined) {
      state.levelId = String(options.levelId);
      const pinned = levels.getByLevelId(BigInt(options.levelId));
      if (pinned) {
        this.analysis = pinned.analysis;
        state.layoutHash = pinned.layoutHash;
        state.timeLimitMs = pinned.analysis.timeLimitMs;
        state.checkpointCount = pinned.analysis.checkpoints.length;
      }
    }
    if (!this.analysis && options.timeLimitSec) state.timeLimitMs = options.timeLimitSec * 1000;
    state.raceId =
      options.raceId && isHex(options.raceId) && options.raceId.length === 66 ? options.raceId.toLowerCase() : keccak256(toHex(this.roomId));

    this.setMetadata({ mode: state.mode, levelId: state.levelId, raceId: state.raceId });

    this.onMessage("ready", (client) => this.handleReady(client));
    this.onMessage("pos", (client, msg) => this.handlePos(client, msg));
    this.onMessage("checkpoint", (client, msg) => this.handleCheckpoint(client, msg));
    this.onMessage("coin", (client, msg) => {
      const p = this.player(client);
      const m = coinSchema.safeParse(msg);
      if (p && m.success && this.state.phase === "running") p.coins = Math.min(m.data.count, this.analysis?.maxCoins ?? 255);
    });
    this.onMessage("finish", (client) => this.handleFinish(client));
  }

  onAuth(_client: Client, rawOptions: unknown) {
    const parsed = joinOptionsSchema.safeParse(rawOptions ?? {});
    if (!parsed.success) throw new ServerError(4001, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const options = parsed.data;
    const address = getAddress(options.address);
    if (this.state.phase !== "waiting") throw new ServerError(4003, "match already started");
    for (const p of this.state.players.values()) {
      if (p.address === address && p.connected) throw new ServerError(4009, "address already in room");
    }
    if (options.signature) {
      // Ownership proof is optional for now; when present it must be valid.
      // TODO(auth): require it (or SIWE) once the web client signs joinMessage().
      return verifyMessage({ address, message: joinMessage(this.roomId, address), signature: options.signature as Hex }).then((ok) => {
        if (!ok) throw new ServerError(4001, "invalid join signature");
        return { address, name: options.name };
      });
    }
    return { address, name: options.name };
  }

  onJoin(client: Client<ClientData>, _options: unknown, auth: { address: Address; name?: string }) {
    client.userData = { address: auth.address };
    const p = new PlayerState();
    p.address = auth.address;
    p.name = auth.name ?? `${auth.address.slice(0, 6)}…${auth.address.slice(-4)}`;
    if (this.analysis) {
      p.x = this.analysis.spawn.x;
      p.y = this.analysis.spawn.y;
    }
    this.state.players.set(client.sessionId, p);
  }

  async onLeave(client: Client<ClientData>, consented: boolean) {
    const p = this.player(client);
    if (!p) return;
    if (this.state.phase === "waiting" || this.state.phase === "finished") {
      this.state.players.delete(client.sessionId);
      return;
    }
    p.connected = false;
    try {
      if (consented) throw new Error("left");
      await this.allowReconnection(client, RECONNECT_SEC);
      p.connected = true;
    } catch {
      p.connected = false;
      this.checkAllDone();
    }
  }

  protected player(client: Client): PlayerState | undefined {
    return this.state.players.get(client.sessionId);
  }

  protected now(): number {
    return Date.now();
  }

  private handleReady(client: Client) {
    const p = this.player(client);
    if (!p || this.state.phase !== "waiting") return;
    p.ready = true;
    const players = [...this.state.players.values()];
    if (players.length >= this.state.minPlayers && players.every((x) => x.ready)) this.startCountdown();
  }

  protected startCountdown() {
    this.state.phase = "countdown";
    this.state.startAt = this.now() + COUNTDOWN_MS;
    void this.lock();
    this.broadcast("countdown", { startAt: this.state.startAt });
    this.clock.setTimeout(() => {
      this.state.phase = "running";
      this.broadcast("start", { startAt: this.state.startAt });
      this.clock.setInterval(() => {
        this.state.elapsedMs = Math.max(0, this.now() - this.state.startAt);
      }, PATCH_RATE_MS);
      this.clock.setTimeout(() => void this.end(), this.state.timeLimitMs);
    }, COUNTDOWN_MS);
  }

  protected strike(client: Client, p: PlayerState, reason: string) {
    p.strikes += 1;
    client.send("violation", { reason, strikes: p.strikes });
    if (p.strikes >= MAX_STRIKES && !p.disqualified) {
      p.disqualified = true;
      this.broadcast("disqualified", { address: p.address, reason });
      this.checkAllDone();
    }
  }

  private handlePos(client: Client, raw: unknown) {
    const p = this.player(client);
    const m = posSchema.safeParse(raw);
    if (!p || !m.success || this.state.phase !== "running" || p.finished || p.disqualified) return;
    const msg = m.data;
    if (msg.f <= p.frame && p.frame !== 0) return; // stale/out-of-order packet
    // Client frames may not run ahead of server time (+ 1 s jitter slack).
    const serverFrames = ((this.now() - this.state.startAt + 1000) * PHYSICS.tickHz) / 1000;
    if (msg.f > serverFrames) return this.strike(client, p, "clock ahead of server");

    if (p.frame !== 0) {
      const issue = checkStep({ f: p.frame, x: p.x, y: p.y }, { f: msg.f, x: msg.x, y: msg.y }, this.analysis?.teleports ?? []);
      const respawns = this.analysis ? [this.analysis.spawn, ...this.respawnPoints()] : [];
      const isRespawn = respawns.some((r) => Math.hypot(r.x - msg.x, r.y - msg.y) <= 1.5);
      if (issue && !isRespawn) {
        this.strike(client, p, issue.message);
        // Reject the move: client will be corrected by the authoritative state.
        return;
      }
    }
    p.frame = msg.f;
    p.x = msg.x;
    p.y = msg.y;
    p.vx = msg.vx;
    p.vy = msg.vy;
  }

  /** Points where a player may legally reappear (checkpoints already reached). */
  protected respawnPoints(): { x: number; y: number }[] {
    return this.analysis?.checkpoints ?? [];
  }

  private handleCheckpoint(client: Client, raw: unknown) {
    const p = this.player(client);
    const m = checkpointSchema.safeParse(raw);
    if (!p || !m.success || this.state.phase !== "running" || p.finished || p.disqualified) return;
    if (!this.analysis) {
      p.checkpoint += 1; // unknown level: accept in order of arrival
      return this.onCheckpoint(p, p.checkpoint);
    }
    const idx = this.analysis.checkpoints.findIndex((c) => c.id === m.data.id);
    if (idx < 0) return this.strike(client, p, `unknown checkpoint ${m.data.id}`);
    if (idx <= p.checkpoint) return; // already reached (or shared in co-op)
    if (idx !== p.checkpoint + 1 && !this.allowCheckpointSkip(idx)) return this.strike(client, p, "checkpoint out of order");
    const cp = this.analysis.checkpoints[idx];
    if (Math.hypot(cp.x - p.x, cp.y - p.y) > 3) return this.strike(client, p, "checkpoint too far from player");
    p.checkpoint = idx;
    this.onCheckpoint(p, idx);
  }

  /** Co-op allows jumping to the shared checkpoint + 1. */
  protected allowCheckpointSkip(_idx: number): boolean {
    return false;
  }

  private handleFinish(client: Client) {
    const p = this.player(client);
    if (!p || this.state.phase !== "running" || p.finished || p.disqualified) return;
    const elapsed = this.now() - this.state.startAt;
    if (this.analysis) {
      if (p.checkpoint + 1 < this.analysis.checkpoints.length && !this.allowCheckpointSkip(this.analysis.checkpoints.length)) {
        return this.strike(client, p, "finish before all checkpoints");
      }
      if (Math.hypot(this.analysis.goal.x - p.x, this.analysis.goal.y - p.y) > PHYSICS.goalRadiusTiles) {
        return this.strike(client, p, "finish too far from goal");
      }
      if (elapsed < this.analysis.minTimeMs) return this.strike(client, p, "finish faster than level minimum time");
    }
    p.finished = true;
    p.finishTimeMs = Math.max(0, Math.round(elapsed));
    this.state.finishOrder.push(p.address);
    this.broadcast("finished", { address: p.address, timeMs: p.finishTimeMs, place: this.state.finishOrder.length });
    this.onPlayerFinished(p);
    this.checkAllDone();
  }

  protected checkAllDone() {
    if (this.state.phase !== "running") return;
    const active = [...this.state.players.values()].filter((p) => p.connected && !p.disqualified);
    if (active.every((p) => p.finished)) void this.end();
  }

  protected async end() {
    if (this.ended) return;
    this.ended = true;
    this.state.phase = "finished";
    this.state.elapsedMs = Math.max(0, this.now() - this.state.startAt);
    this.clock.clear();
    try {
      await this.settle();
    } catch (err) {
      roomServices().log?.("room settle failed", err);
      this.broadcast("result", { error: (err as Error).message });
    }
  }
}
