import type { Client } from "@colyseus/core";
import { toJsonSafe } from "../eip712.js";
import { BaseMatchRoom } from "./BaseMatchRoom.js";
import { roomServices } from "./services.js";
import { CoopState, type PlayerState } from "./state.js";

/**
 * Co-op (SPEC §3.5): 2–4 players on the same level with shared checkpoints;
 * everyone must reach the goal. When all active players finish, each one receives
 * an EIP-712 RunResult (their own server-timed clear) for ForgeCoin.settleRun.
 */
export class CoopRoom extends BaseMatchRoom<CoopState> {
  protected defaultMinPlayers = 2;

  protected createState() {
    const s = new CoopState();
    s.mode = "coop";
    return s;
  }

  protected onCheckpoint(_p: PlayerState, index: number) {
    if (index <= this.state.sharedCheckpoint) return;
    this.state.sharedCheckpoint = index;
    // Everyone now shares this checkpoint (respawn point).
    for (const other of this.state.players.values()) if (other.checkpoint < index) other.checkpoint = index;
    const cp = this.analysis?.checkpoints[index];
    this.broadcast("checkpoint", { index, x: cp?.x, y: cp?.y });
  }

  protected allowCheckpointSkip(idx: number) {
    return idx <= this.state.sharedCheckpoint + 1;
  }

  protected onPlayerFinished(_p: PlayerState) {}

  protected async settle() {
    const { signer } = roomServices();
    const players = [...this.state.players.entries()];
    const everyoneCleared = players.every(([, p]) => p.finished || !p.connected);
    if (!this.state.levelId) {
      this.broadcast("result", { kind: "coop", cleared: everyoneCleared, error: "unpublished level: nothing to settle" });
      return;
    }
    for (const [sessionId, p] of players) {
      const client = this.clients.find((c: Client) => c.sessionId === sessionId);
      if (!client) continue;
      const cleared = everyoneCleared && p.finished;
      const signed = await signer.signRunResult({
        player: p.address as `0x${string}`,
        levelId: BigInt(this.state.levelId),
        timeMs: cleared ? p.finishTimeMs : Math.min(this.state.elapsedMs, 2 ** 32 - 1),
        cleared,
        coins: p.coins,
      });
      client.send("result", { kind: "coop", result: toJsonSafe(signed.message), signature: signed.signature, signer: signed.signer });
    }
  }
}
