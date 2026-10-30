import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

/** Per-player synchronized state. Positions are in tiles (float), like run traces. */
export class PlayerState extends Schema {
  @type("string") address = "";
  @type("string") name = "";
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") vx = 0;
  @type("float32") vy = 0;
  /** Client fixed-step frame of the last accepted position. */
  @type("uint32") frame = 0;
  /** Index into the level's ordered checkpoints (-1 = none yet). */
  @type("int16") checkpoint = -1;
  @type("boolean") ready = false;
  @type("boolean") connected = true;
  @type("boolean") finished = false;
  /** Server-timed finish (ms since race start). 0 if not finished. */
  @type("uint32") finishTimeMs = 0;
  @type("uint8") coins = 0;
  /** Plausibility violations (speed, checkpoint order). */
  @type("uint8") strikes = 0;
  @type("boolean") disqualified = false;
}

export type Phase = "waiting" | "countdown" | "running" | "finished";

export class MatchState extends Schema {
  @type("string") mode = "race";
  @type("string") phase: Phase = "waiting";
  /** On-chain LevelNFT id ("" for unpublished/dev levels). */
  @type("string") levelId = "";
  @type("string") layoutHash = "";
  /** bytes32 race id used by ForgeCoin.createRaceRoom / settleRace. */
  @type("string") raceId = "";
  @type("uint8") minPlayers = 2;
  @type("uint8") checkpointCount = 0;
  /** Server epoch ms when the countdown ends / race started (0 if not yet). */
  @type("float64") startAt = 0;
  @type("uint32") elapsedMs = 0;
  @type("uint32") timeLimitMs = 300_000;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  /** Addresses in finish order. */
  @type(["string"]) finishOrder = new ArraySchema<string>();
}

export class CoopState extends MatchState {
  /** Highest checkpoint index reached by anyone — everyone respawns there (shared checkpoints). */
  @type("int16") sharedCheckpoint = -1;
}
