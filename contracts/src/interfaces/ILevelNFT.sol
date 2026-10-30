// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ILevelNFT — the frozen interface between LevelNFT (Student A) and ForgeCoin (Student B)
/// @notice SPEC §6. Owned by Student A, consumed by Student B. Do NOT change these signatures
///         without both students agreeing: ForgeCoin, MockLevelNFT, the server and the web app depend on them.
interface ILevelNFT {
    /// @notice Everything ForgeCoin needs to settle a run on level `id`.
    /// @dev MUST revert if `id` was never minted.
    /// @param id Level token id.
    /// @return owner Current NFT owner (receives 70% of the play fee).
    /// @return creator Original author (immutable).
    /// @return playFee Play fee in FORGE wei (18 decimals).
    /// @return active False when the owner has taken the level offline.
    function levelInfo(uint256 id)
        external
        view
        returns (address owner, address creator, uint96 playFee, bool active);

    /// @notice Records a settled run (plays++, clears++ if cleared, best time).
    /// @dev Restricted to GAME_ROLE (= the ForgeCoin contract).
    /// @param id Level token id.
    /// @param player Player who did the run.
    /// @param timeMs Run duration in milliseconds (server-validated).
    /// @param cleared True if the goal was reached.
    function recordRun(uint256 id, address player, uint32 timeMs, bool cleared) external;
}
