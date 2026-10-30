import type { LevelRepo } from "../levels.js";
import type { GameSigner } from "../signer.js";

export interface RoomServices {
  signer: GameSigner;
  levels: LevelRepo;
  log?: (msg: string, extra?: unknown) => void;
}

let services: RoomServices | null = null;

/**
 * Rooms get their dependencies through this module-level registry instead of
 * `gameServer.define(..., defaultOptions)`, because client-supplied join/create
 * options are merged over default options and could shadow them.
 */
export function configureRooms(s: RoomServices): void {
  services = s;
}

export function roomServices(): RoomServices {
  if (!services) throw new Error("rooms not configured: call configureRooms() before starting the game server");
  return services;
}
