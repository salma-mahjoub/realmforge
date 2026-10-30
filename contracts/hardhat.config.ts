import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

/**
 * RealmForge contracts — Hardhat 3 configuration.
 *
 * Secrets are never hard-coded: `configVariable` reads them lazily from the
 * environment (see .env.example) or from the Hardhat keystore
 * (`npx hardhat keystore set SEPOLIA_RPC_URL`). They are only resolved when a
 * task actually connects to Sepolia, so `build` / `test` work without them.
 */
export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  // SPEC §9 layout: contracts in src/, tests (Solidity *.t.sol + TypeScript *.ts) in test/.
  paths: {
    sources: "src",
    tests: {
      solidity: "test",
      nodejs: "test",
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    // `npx hardhat node` in another terminal, then `--network localhost` (used by web/ and server/ dev).
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
});
