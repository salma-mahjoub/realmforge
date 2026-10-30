import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CoopRoom, RaceRoom, configureRooms } from "./rooms/index.js";
import type { RoomServices } from "./rooms/services.js";

/** Create the Colyseus game server with `race` and `coop` rooms. */
export function createGameServer(services: RoomServices): Server {
  configureRooms(services);
  const gameServer = new Server({ transport: new WebSocketTransport(), gracefullyShutdown: false });
  gameServer.define("race", RaceRoom).enableRealtimeListing();
  gameServer.define("coop", CoopRoom).enableRealtimeListing();
  return gameServer;
}
