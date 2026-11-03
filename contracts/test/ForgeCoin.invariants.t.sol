// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {ForgeCoin} from "../src/ForgeCoin.sol";
import {IForgeCoin} from "../src/interfaces/IForgeCoin.sol";
import {MockLevelNFT} from "../src/mocks/MockLevelNFT.sol";

/// @notice Random-action driver for the invariant tests: every public function below is called in random
///         order with random arguments. Reverts are swallowed (`try/catch`) because most random calls are
///         invalid on purpose; what matters is that the invariants hold after every call that did succeed.
contract ForgeCoinHandler is Test {
    ForgeCoin public immutable coin;
    MockLevelNFT public immutable mock;
    uint256 internal immutable signerPk;

    uint256 internal constant LEVEL = 1;
    address[] internal actors;
    bytes32[] internal rooms;
    uint256 internal runNonce;

    constructor(ForgeCoin coin_, MockLevelNFT mock_, uint256 signerPk_) {
        coin = coin_;
        mock = mock_;
        signerPk = signerPk_;
        for (uint256 i; i < 5; ++i) {
            actors.push(makeAddr(string.concat("actor", vm.toString(i))));
        }
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i];
    }

    function roomCount() external view returns (uint256) {
        return rooms.length;
    }

    function roomAt(uint256 i) external view returns (bytes32) {
        return rooms[i];
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _room(uint256 seed) internal view returns (bytes32) {
        return rooms[seed % rooms.length];
    }

    // ------------------------------------------------------------------ actions

    function claim(uint256 seed) external {
        vm.prank(_actor(seed));
        try coin.claimFaucet() {} catch {}
    }

    /// actors[0] owns the level, so random calls also cover the self-play path.
    function play(uint256 seed, bool cleared, uint32 timeMs, uint16 coins, uint8 feeChoice) external {
        address p = _actor(seed);
        mock.setLevel(LEVEL, actors[0], actors[0], uint96(bound(feeChoice, 0, 3)) * 5e18, true);
        IForgeCoin.RunResult memory r = IForgeCoin.RunResult({
            player: p,
            levelId: LEVEL,
            timeMs: timeMs,
            cleared: cleared,
            coins: coins,
            nonce: ++runNonce,
            deadline: block.timestamp + 1 hours
        });
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(signerPk, coin.hashRunResult(r));
        vm.startPrank(p);
        coin.approve(address(coin), type(uint256).max);
        try coin.settleRun(r, abi.encodePacked(rr, s, v)) {} catch {}
        vm.stopPrank();
    }

    function createRace(uint256 seed, uint256 stakeRaw) external {
        bytes32 room = keccak256(abi.encode("room", rooms.length));
        vm.prank(_actor(seed));
        try coin.createRaceRoom(room, LEVEL, bound(stakeRaw, 1, 20e18)) {
            rooms.push(room);
        } catch {}
    }

    function joinRace(uint256 roomSeed, uint256 actorSeed) external {
        if (rooms.length == 0) return;
        vm.prank(_actor(actorSeed));
        try coin.joinRace(_room(roomSeed)) {} catch {}
    }

    /// Ranks the room's players in a rotated order, signed by the server key.
    function settleRace(uint256 roomSeed, uint256 rotation) external {
        if (rooms.length == 0) return;
        bytes32 room = _room(roomSeed);
        address[] memory players = coin.getRace(room).players;
        uint256 n = players.length;
        if (n < 2) return;
        address[] memory ranking = new address[](n);
        for (uint256 i; i < n; ++i) {
            ranking[i] = players[(rotation + i) % n];
        }
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(signerPk, coin.hashRaceResult(room, ranking, deadline));
        try coin.settleRace(room, ranking, deadline, abi.encodePacked(rr, s, v)) {} catch {}
    }

    function refundRace(uint256 roomSeed) external {
        if (rooms.length == 0) return;
        vm.warp(block.timestamp + 1 hours + 1);
        try coin.refundRace(_room(roomSeed)) {} catch {}
    }

    function withdrawTreasury() external {
        try coin.withdrawTreasury(makeAddr("treasury")) {} catch {}
    }

    function closeSeason(uint256 seed) external {
        address[] memory players = new address[](2);
        players[0] = _actor(seed);
        players[1] = _actor(seed + 1);
        address[] memory creators = new address[](1);
        creators[0] = _actor(seed + 2);
        uint256[] memory shares = new uint256[](3);
        shares[0] = 5_000;
        shares[1] = 3_000;
        shares[2] = 2_000;
        (uint8 v, bytes32 rr, bytes32 s) =
            vm.sign(signerPk, coin.hashSeasonResult(coin.season(), players, creators, shares));
        try coin.closeSeason(players, creators, shares, abi.encodePacked(rr, s, v)) {} catch {}
    }

    function warp(uint256 secondsForward) external {
        vm.warp(block.timestamp + bound(secondsForward, 0, 10 days));
    }
}

/// @title ForgeCoin invariants (SPEC §11): properties that must hold after ANY sequence of calls.
contract ForgeCoinInvariantTest is StdInvariant, Test {
    ForgeCoin internal coin;
    MockLevelNFT internal mock;
    ForgeCoinHandler internal handler;

    uint256 internal signerPk = 0x5E4E4;

    function setUp() public {
        coin = new ForgeCoin(vm.addr(signerPk));
        mock = new MockLevelNFT();
        mock.setGame(address(coin));
        coin.setLevelNFT(mock);
        handler = new ForgeCoinHandler(coin, mock, signerPk);
        coin.grantRole(coin.DEFAULT_ADMIN_ROLE(), address(handler)); // lets the handler call closeSeason/withdrawTreasury
        targetContract(address(handler));
    }

    /// The tokens held by the contract are exactly: season pool + treasury + escrow of open races.
    /// No path (fees, races, refunds, seasons, withdrawals) may create or lose FORGE inside the contract.
    function invariant_ContractBalanceIsFullyAccounted() public view {
        uint256 escrow;
        for (uint256 i; i < handler.roomCount(); ++i) {
            ForgeCoin.Race memory race = coin.getRace(handler.roomAt(i));
            if (race.status == ForgeCoin.RaceStatus.Open) escrow += race.stake * race.players.length;
        }
        assertEq(coin.balanceOf(address(coin)), coin.seasonPool() + coin.treasuryBalance() + escrow);
    }

    function invariant_SupplyNeverExceedsCap() public view {
        assertLe(coin.totalSupply(), coin.cap());
    }

    function invariant_DailyMintCapRespected() public view {
        for (uint256 i; i < handler.actorCount(); ++i) {
            assertLe(coin.mintedOnDay(handler.actorAt(i), block.timestamp / 1 days), coin.DAILY_MINT_CAP());
        }
    }
}
