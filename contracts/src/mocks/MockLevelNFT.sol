// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILevelNFT} from "../interfaces/ILevelNFT.sol";

/// @title MockLevelNFT — test double so Student B can test ForgeCoin without LevelNFT (SPEC §6)
/// @notice Anyone can configure levels. `recordRun` only stores the last call and counts calls.
/// @dev NOT for deployment. Behaves like LevelNFT for the two ILevelNFT functions:
///      `levelInfo` reverts for unknown ids, `recordRun` can be restricted to one caller (the ForgeCoin).
contract MockLevelNFT is ILevelNFT {
    struct MockLevel {
        address owner;
        address creator;
        uint96 playFee;
        bool active;
        bool exists;
    }

    struct RecordedRun {
        uint256 id;
        address player;
        uint32 timeMs;
        bool cleared;
    }

    error UnknownLevel(uint256 id);
    error NotGame(address caller);

    mapping(uint256 => MockLevel) public mockLevels;
    /// @notice If non-zero, only this address may call {recordRun} (mimics GAME_ROLE).
    address public game;
    uint256 public recordRunCalls;
    RecordedRun public lastRun;

    /// @notice Creates or overwrites a level.
    function setLevel(uint256 id, address owner, address creator, uint96 playFee, bool active) external {
        mockLevels[id] = MockLevel(owner, creator, playFee, active, true);
    }

    /// @notice Toggles `active` of an existing level.
    function setActive(uint256 id, bool active) external {
        mockLevels[id].active = active;
    }

    /// @notice Restricts {recordRun} to `game` (address(0) = anyone).
    function setGame(address game_) external {
        game = game_;
    }

    /// @inheritdoc ILevelNFT
    function levelInfo(uint256 id)
        external
        view
        returns (address owner, address creator, uint96 playFee, bool active)
    {
        MockLevel storage l = mockLevels[id];
        if (!l.exists) revert UnknownLevel(id);
        return (l.owner, l.creator, l.playFee, l.active);
    }

    /// @inheritdoc ILevelNFT
    function recordRun(uint256 id, address player, uint32 timeMs, bool cleared) external {
        if (game != address(0) && msg.sender != game) revert NotGame(msg.sender);
        if (!mockLevels[id].exists) revert UnknownLevel(id);
        recordRunCalls++;
        lastRun = RecordedRun(id, player, timeMs, cleared);
    }
}
