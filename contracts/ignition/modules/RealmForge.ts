import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * RealmForge deployment — SPEC §6 deploy order:
 *   1. ForgeCoin(signer)
 *   2. LevelNFT(signer)
 *   3. forgeCoin.setLevelNFT(levelNFT)
 *   4. levelNFT.grantRole(GAME_ROLE, forgeCoin)
 *
 * Parameter `signer` = PUBLIC address of the game-server signing key.
 * Local default: account #0 (the deployer). Sepolia: ignition/parameters/sepolia.json.
 *
 *   npx hardhat ignition deploy ignition/modules/RealmForge.ts
 *   npx hardhat ignition deploy ignition/modules/RealmForge.ts --network sepolia \
 *     --parameters ignition/parameters/sepolia.json --verify
 */
export default buildModule("RealmForgeModule", (m) => {
  const signer = m.getParameter("signer", m.getAccount(0));

  const forgeCoin = m.contract("ForgeCoin", [signer]);
  const levelNFT = m.contract("LevelNFT", [signer]);

  const linked = m.call(forgeCoin, "setLevelNFT", [levelNFT]);

  const gameRole = m.staticCall(levelNFT, "GAME_ROLE", []);
  m.call(levelNFT, "grantRole", [gameRole, forgeCoin], { after: [linked] });

  return { forgeCoin, levelNFT };
});
