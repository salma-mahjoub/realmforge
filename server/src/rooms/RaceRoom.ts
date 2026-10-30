import type { Address, Hex } from "viem";
import { toJsonSafe } from "../eip712.js";
import { BaseMatchRoom } from "./BaseMatchRoom.js";
import { roomServices } from "./services.js";
import { MatchState, type PlayerState } from "./state.js";

/**
 * Versus race (SPEC §3.5): 2–4 players, first to the goal wins the pot.
 * Server-timed. On finish the server signs an EIP-712 RaceResult(roomId, ranking)
 * that anyone can submit to ForgeCoin.settleRace (the room id is single-use on-chain).
 */
export class RaceRoom extends BaseMatchRoom<MatchState> {
  /** Last signed result, kept for late fetches/tests. */
  result: unknown = null;

  protected createState() {
    const s = new MatchState();
    s.mode = "race";
    return s;
  }

  protected onCheckpoint(_p: PlayerState, _i: number) {}
  protected onPlayerFinished(_p: PlayerState) {}

  protected async settle() {
    const ranking = [...this.state.finishOrder] as Address[];
    const signed = await roomServices().signer.signRaceResult({ roomId: this.state.raceId as Hex, ranking });
    this.result = {
      kind: "race",
      result: toJsonSafe(signed.message),
      signature: signed.signature,
      signer: signed.signer,
      times: Object.fromEntries([...this.state.players.values()].map((p) => [p.address, p.finished ? p.finishTimeMs : null])),
    };
    this.broadcast("result", this.result);
  }
}
