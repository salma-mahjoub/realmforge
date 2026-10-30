// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IForgeCoin — public game surface of ForgeCoin (SPEC §5)
/// @notice Shared types + events so the server, web and tests can rely on one definition.
///         ERC-20 / ERC-2612 functions come from OpenZeppelin and are not repeated here.
interface IForgeCoin {
    /// @notice Server-signed result of one run (SPEC §5.2). EIP-712 type:
    ///         `RunResult(address player,uint256 levelId,uint32 timeMs,bool cleared,uint16 coins,uint256 nonce,uint256 deadline)`
    struct RunResult {
        address player;
        uint256 levelId;
        uint32 timeMs;
        bool cleared;
        uint16 coins;
        uint256 nonce;
        uint256 deadline;
    }

    // ------------------------------------------------------------------ events (SPEC §5.4)
    event FaucetClaimed(address indexed user);
    event RunSettled(
        address indexed player, uint256 indexed levelId, uint32 timeMs, bool cleared, uint256 reward, uint256 feePaid
    );
    event FeeSplit(
        uint256 indexed levelId, address indexed owner, uint256 ownerAmt, uint256 poolAmt, uint256 treasuryAmt
    );
    event RaceCreated(bytes32 indexed roomId, uint256 indexed levelId, address indexed creator, uint256 stake);
    event RaceJoined(bytes32 indexed roomId, address indexed player);
    event RaceSettled(bytes32 indexed roomId, address first, address second, uint256 pot);
    event RaceRefunded(bytes32 indexed roomId, uint256 playerCount, uint256 stake);
    event SeasonClosed(uint256 indexed season, uint256 pool);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);
    event LevelNFTSet(address indexed levelNFT);
    event TreasuryWithdrawn(address indexed to, uint256 amount);

    // ------------------------------------------------------------------ game functions
    function claimFaucet() external;
    function settleRun(RunResult calldata r, bytes calldata sig) external;
    function settleRunWithPermit(
        RunResult calldata r,
        bytes calldata sig,
        uint8 v,
        bytes32 rr,
        bytes32 s,
        uint256 permitDeadline
    ) external;
    function createRaceRoom(bytes32 roomId, uint256 levelId, uint256 stake) external;
    function joinRace(bytes32 roomId) external;
    function settleRace(bytes32 roomId, address[] calldata ranking, bytes calldata sig) external;
    function refundRace(bytes32 roomId) external;
    function closeSeason(
        address[] calldata players,
        address[] calldata creators,
        uint256[] calldata shares,
        bytes calldata sig
    ) external;
}
