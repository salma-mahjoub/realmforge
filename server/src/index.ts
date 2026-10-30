import { buildApi } from "./api/server.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { createGameServer } from "./game.js";
import { Indexer } from "./indexer/index.js";
import { createServices } from "./services.js";

async function main() {
  loadDotEnv();
  const config = loadConfig();
  const svc = createServices(config);

  const api = await buildApi(svc, { logger: true });
  const log = (msg: string, extra?: unknown) => api.log.info(extra === undefined ? {} : { extra }, msg);

  if (config.NODE_ENV !== "production" && svc.signer.address.toLowerCase() === "0x70997970c51812dc3a010c7d01b50e0d17dc79c8") {
    api.log.warn("Using the PUBLIC Hardhat test key #1 as signer — local development only.");
  }

  // Event indexer (only when contract addresses are configured)
  const contracts = [
    ...(config.LEVEL_NFT_ADDRESS ? [{ name: "LevelNFT" as const, address: config.LEVEL_NFT_ADDRESS }] : []),
    ...(config.FORGE_COIN_ADDRESS ? [{ name: "ForgeCoin" as const, address: config.FORGE_COIN_ADDRESS }] : []),
  ];
  let indexer: Indexer | null = null;
  if (config.INDEXER_ENABLED && contracts.length > 0) {
    indexer = new Indexer({ db: svc.db, rpcUrl: config.RPC_URL, chainId: config.CHAIN_ID, contracts, startBlock: config.INDEXER_START_BLOCK, log });
    indexer.start().catch((err) => api.log.error({ err }, "indexer failed to start (API keeps running)"));
  } else {
    api.log.warn("indexer disabled (no contract addresses configured)");
  }

  await api.listen({ host: config.HOST, port: config.PORT });

  const game = createGameServer({ signer: svc.signer, levels: svc.levels, log });
  await game.listen(config.GAME_PORT, config.HOST);
  api.log.info(`Colyseus game server listening on ws://${config.HOST}:${config.GAME_PORT}`);

  const shutdown = async (signal: string) => {
    api.log.info(`${signal} received, shutting down`);
    indexer?.stop();
    await Promise.allSettled([api.close(), game.gracefullyShutdown(false)]);
    svc.db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
