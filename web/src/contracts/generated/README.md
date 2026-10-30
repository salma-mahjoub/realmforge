# contracts/generated

Target folder for ABIs exported by `contracts/` (Hardhat/Foundry build → TS `as const` ABIs,
e.g. via `@wagmi/cli` or a small export script).

Expected exports (consumed through `index.ts`):

| Export | Source contract |
|---|---|
| `levelNftAbi` | `LevelNFT.sol` (ERC-721, SPEC §4) |
| `forgeCoinAbi` | `ForgeCoin.sol` (ERC-20, SPEC §5) |

Until then `index.ts` re-exports the interim hand-written fragments from `../abi.interim.ts`.
