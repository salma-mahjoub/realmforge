# Deployments

## Sepolia (chain id 11155111)

Deployed on 2 November 2026 with Hardhat Ignition (`npm run deploy:sepolia` in `contracts/`), solc 0.8.28,
optimizer 200 runs, from the commit `feature/forgecoin-hardening` of this repository.

| Contract | Address | Explorer |
|---|---|---|
| ForgeCoin (ERC-20 `FORGE`) | `0x5d40434c1B59F4f2Be0B986373C074571133421e` | [Etherscan](https://sepolia.etherscan.io/address/0x5d40434c1B59F4f2Be0B986373C074571133421e#code) · [Blockscout](https://eth-sepolia.blockscout.com/address/0x5d40434c1B59F4f2Be0B986373C074571133421e#code) |
| LevelNFT (ERC-721 `RFLVL`) | `0xC040D6E51e6e59f1764Bc30c1Cf5fB40E4736f09` | [Etherscan](https://sepolia.etherscan.io/address/0xC040D6E51e6e59f1764Bc30c1Cf5fB40E4736f09#code) |

Both are verified on Etherscan and Sourcify; ForgeCoin is also verified on Blockscout (the LevelNFT Blockscout
submission was rate limited, 429, and is not needed).

| Role | Address |
|---|---|
| Deployer = `DEFAULT_ADMIN_ROLE` on both contracts (pause, withdrawTreasury, closeSeason, setSigner, grantRole) | `0x8dCD4c4a548605C01dff3Fb81861cF1b82d1DfcD` |
| Game-server signer (`ForgeCoin.signer`, `SIGNER_ROLE` on LevelNFT) | `0xE68E255Da112d8Bbac3C477207F28aFbb9747129` |

The private key of the signer lives only in `server/.env` (never committed). The deployer is a throw-away
wallet used for this demo; a production deployment would hand the admin role to a multisig.

### Transactions

| Step | Block | Transaction |
|---|---|---|
| Deploy ForgeCoin | 12048731 | `0x3ae1485de68b651e17c7c389deb0ba98cd0f1bb49355a75602e9ec1a5bf3c59c` |
| Deploy LevelNFT | 12048731 | `0x76f316d5576cadcb4ef05c1318abcf18ecd3c57f8c347cb2a9102f7c996cf742` |
| `ForgeCoin.setLevelNFT` | 12048736 | `0x750cc0eb8db697da9ca518acabc75c1beb574e8ab68efca5bc0ce4ecd2d017c7` |
| `LevelNFT.grantRole(GAME_ROLE, ForgeCoin)` | 12048741 | `0x1bb3830edc61e20d3e41ee40e293249097aeccb077f73c6e4ad30e217e3673a3` |

### Post-deployment checks (read from the chain)

- `ForgeCoin.levelNFT()` = the LevelNFT address above
- `ForgeCoin.signer()` = the signer address above, `paused()` = false, `season()` = 1, `cap()` = 100,000,000 FORGE
- `LevelNFT.hasRole(GAME_ROLE, ForgeCoin)` = true; `LevelNFT.hasRole(SIGNER_ROLE, signer)` = true
- the deployer holds `DEFAULT_ADMIN_ROLE` on both contracts

### Configuration for the apps

- `server/.env`: `CHAIN_ID=11155111`, `RPC_URL=<a Sepolia RPC>`, `LEVEL_NFT_ADDRESS`, `FORGE_COIN_ADDRESS`,
  `SIGNER_PRIVATE_KEY` (the key of the signer above), `INDEXER_START_BLOCK=12048731`
- `web/.env.local`: `VITE_DEFAULT_CHAIN_ID=11155111`, `VITE_LEVEL_NFT_ADDRESS`, `VITE_FORGE_COIN_ADDRESS`
- `web/src/contracts/generated/addresses.json` already lists the Sepolia addresses.

## Local (chain id 31337)

Addresses change at every `npm run deploy:local`; they are written to `web/.env.local` and `server/.env`.
