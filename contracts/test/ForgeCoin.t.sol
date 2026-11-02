// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ForgeCoin} from "../src/ForgeCoin.sol";
import {IForgeCoin} from "../src/interfaces/IForgeCoin.sol";
import {ILevelNFT} from "../src/interfaces/ILevelNFT.sol";
import {MockLevelNFT} from "../src/mocks/MockLevelNFT.sol";

/// @title ForgeCoin unit + fuzz tests (Student B), against MockLevelNFT — `npx hardhat test solidity`
contract ForgeCoinTest is Test {
    ForgeCoin internal coin;
    MockLevelNFT internal mock;

    uint256 internal signerPk = 0x5E4E4;
    address internal signer;
    address internal owner = makeAddr("levelOwner");
    address internal player = makeAddr("player");
    address internal player2 = makeAddr("player2");

    uint256 internal constant LEVEL = 1;
    uint96 internal constant FEE = 10e18;

    function setUp() public {
        signer = vm.addr(signerPk);
        coin = new ForgeCoin(signer);
        mock = new MockLevelNFT();
        mock.setLevel(LEVEL, owner, owner, FEE, true);
        mock.setGame(address(coin));
        coin.setLevelNFT(mock);
    }

    // ------------------------------------------------------------------ helpers

    function _run(address p, uint256 nonce, bool cleared, uint32 timeMs)
        internal
        view
        returns (IForgeCoin.RunResult memory r)
    {
        r = IForgeCoin.RunResult({
            player: p,
            levelId: LEVEL,
            timeMs: timeMs,
            cleared: cleared,
            coins: 0, // neutral by default so reward tests stay about one rule at a time
            nonce: nonce,
            deadline: block.timestamp + 10 minutes
        });
    }

    function _signRun(uint256 pk, IForgeCoin.RunResult memory r) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, coin.hashRunResult(r));
        return abi.encodePacked(rr, s, v);
    }

    function _fundAndApprove(address p) internal {
        vm.startPrank(p);
        coin.claimFaucet();
        coin.approve(address(coin), type(uint256).max);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ deploy / admin

    function test_Deploy() public view {
        assertEq(coin.name(), "ForgeCoin");
        assertEq(coin.symbol(), "FORGE");
        assertEq(coin.cap(), 100_000_000e18);
        assertEq(coin.signer(), signer);
        assertEq(address(coin.levelNFT()), address(mock));
        assertEq(coin.season(), 1);
        assertTrue(coin.hasRole(coin.DEFAULT_ADMIN_ROLE(), address(this)));
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = coin.eip712Domain();
        assertEq(name, "RealmForge ForgeCoin");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(coin));
    }

    function test_SetLevelNFT_OnlyOnce() public {
        vm.expectRevert(ForgeCoin.LevelNFTAlreadySet.selector);
        coin.setLevelNFT(mock);
    }

    function test_AdminFunctions_OnlyAdmin() public {
        vm.startPrank(player);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, player, coin.DEFAULT_ADMIN_ROLE()
            )
        );
        coin.setSigner(player);
        vm.expectRevert();
        coin.pause();
        vm.expectRevert();
        coin.withdrawTreasury(player);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ faucet

    function test_Faucet_OncePerAddress() public {
        vm.startPrank(player);
        coin.claimFaucet();
        assertEq(coin.balanceOf(player), 100e18);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.FaucetAlreadyClaimed.selector, player));
        coin.claimFaucet();
        vm.stopPrank();
    }

    function test_Pause_BlocksFaucet() public {
        coin.pause();
        vm.prank(player);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        coin.claimFaucet();
        coin.unpause();
        vm.prank(player);
        coin.claimFaucet();
    }

    // ------------------------------------------------------------------ settleRun: signatures

    function test_SettleRun_ValidSignature_SplitsFeeAndRecords() public {
        _fundAndApprove(player);
        IForgeCoin.RunResult memory r = _run(player, 1, true, 12_345);
        bytes memory sig = _signRun(signerPk, r); // sign BEFORE prank: view calls consume vm.prank
        vm.prank(player);
        coin.settleRun(r, sig);

        assertEq(coin.balanceOf(owner), 7e18); // 70%
        assertEq(coin.seasonPool(), 2e18); // 20%
        assertEq(coin.treasuryBalance(), 0.5e18); // 10% cut, half of it burned
        assertEq(coin.balanceOf(address(coin)), 2.5e18); // pool + kept treasury
        // first ever clear: base 5 + first clear 20 + record 10 = 35
        assertEq(coin.balanceOf(player), 100e18 - 10e18 + 35e18);
        assertTrue(coin.runNonceUsed(player, 1));
        assertEq(mock.recordRunCalls(), 1);
        (uint256 id, address p, uint32 t, bool c) = mock.lastRun();
        assertEq(id, LEVEL);
        assertEq(p, player);
        assertEq(t, 12_345);
        assertTrue(c);
    }

    function test_SettleRun_RevertsInvalidSignature() public {
        _fundAndApprove(player);
        IForgeCoin.RunResult memory r = _run(player, 1, true, 1000);
        bytes memory sig = _signRun(0xBAD, r);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.InvalidSignature.selector, vm.addr(0xBAD)));
        coin.settleRun(r, sig);
    }

    function test_SettleRun_RevertsTamperedResult() public {
        _fundAndApprove(player);
        IForgeCoin.RunResult memory r = _run(player, 1, false, 1000);
        bytes memory sig = _signRun(signerPk, r);
        r.cleared = true; // player tries to upgrade a failed run
        vm.prank(player);
        vm.expectPartialRevert(ForgeCoin.InvalidSignature.selector);
        coin.settleRun(r, sig);
    }

    function test_SettleRun_RevertsReplay() public {
        _fundAndApprove(player);
        IForgeCoin.RunResult memory r = _run(player, 7, true, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.startPrank(player);
        coin.settleRun(r, sig);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.NonceAlreadyUsed.selector, player, 7));
        coin.settleRun(r, sig);
        vm.stopPrank();
    }

    function test_SettleRun_RevertsExpired() public {
        _fundAndApprove(player);
        IForgeCoin.RunResult memory r = _run(player, 1, true, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.warp(r.deadline + 1);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.SignatureExpired.selector, r.deadline));
        coin.settleRun(r, sig);
    }

    function test_SettleRun_RevertsWrongSender() public {
        IForgeCoin.RunResult memory r = _run(player, 1, true, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(player2);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.NotRunPlayer.selector, player2, player));
        coin.settleRun(r, sig);
    }

    function test_SettleRun_RevertsInactiveLevel() public {
        _fundAndApprove(player);
        mock.setActive(LEVEL, false);
        IForgeCoin.RunResult memory r = _run(player, 1, true, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(player);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.LevelInactive.selector, LEVEL));
        coin.settleRun(r, sig);
    }

    function test_SettleRun_SignerRotation() public {
        _fundAndApprove(player);
        uint256 newPk = 0xC0FFEE;
        coin.setSigner(vm.addr(newPk));
        IForgeCoin.RunResult memory r = _run(player, 1, true, 1000);
        bytes memory oldSig = _signRun(signerPk, r);
        vm.startPrank(player);
        vm.expectPartialRevert(ForgeCoin.InvalidSignature.selector);
        coin.settleRun(r, oldSig);
        coin.settleRun(r, _signRun(newPk, r));
        vm.stopPrank();
    }

    function test_SettleRun_DailyCap() public {
        _fundAndApprove(player);
        mock.setLevel(LEVEL, owner, owner, 0, true); // free level → isolate rewards
        uint256 minted;
        for (uint256 i = 1; i <= 12; ++i) {
            IForgeCoin.RunResult memory r = _run(player, i, true, uint32(100_000 - i)); // record every time
            bytes memory sig = _signRun(signerPk, r);
            vm.prank(player);
            coin.settleRun(r, sig);
        }
        minted = coin.mintedOnDay(player, block.timestamp / 1 days);
        assertEq(minted, 200e18);
        assertEq(coin.balanceOf(player), 100e18 + 200e18);
        vm.warp(block.timestamp + 1 days); // next day, cap resets
        IForgeCoin.RunResult memory r2 = _run(player, 99, true, 1);
        bytes memory sig2 = _signRun(signerPk, r2);
        vm.prank(player);
        coin.settleRun(r2, sig2);
        assertGt(coin.balanceOf(player), 300e18);
    }

    function test_WithdrawTreasury() public {
        _fundAndApprove(player);
        IForgeCoin.RunResult memory r = _run(player, 1, false, 1000);
        bytes memory sig = _signRun(signerPk, r); // sign BEFORE prank: view calls consume vm.prank
        vm.prank(player);
        coin.settleRun(r, sig);
        address treasury = makeAddr("treasury");
        coin.withdrawTreasury(treasury);
        assertEq(coin.balanceOf(treasury), 0.5e18);
        assertEq(coin.treasuryBalance(), 0);
    }

    // ------------------------------------------------------------------ treasury burn

    function test_SettleRun_BurnsHalfOfTreasuryCut() public {
        _fundAndApprove(player);
        uint256 supplyBefore = coin.totalSupply();
        IForgeCoin.RunResult memory r = _run(player, 1, false, 1000); // failed run: nothing minted
        bytes memory sig = _signRun(signerPk, r);

        vm.expectEmit(true, false, false, true);
        emit IForgeCoin.FeeBurned(LEVEL, 0.5e18);
        vm.prank(player);
        coin.settleRun(r, sig);

        assertEq(coin.totalSupply(), supplyBefore - 0.5e18); // 5% of the 10 FORGE fee destroyed
        assertEq(coin.balanceOf(player), 90e18); // the player still pays exactly the fee
        assertEq(coin.balanceOf(owner) + coin.seasonPool() + coin.treasuryBalance() + 0.5e18, 10e18);
    }

    /// Whatever the fee, owner + pool + kept treasury + burned always equals what the player paid.
    function testFuzz_SettleRun_FeeIsFullyAccountedFor(uint96 fee) public {
        fee = uint96(bound(fee, 1, 100e18)); // LevelNFT.MAX_PLAY_FEE
        mock.setLevel(LEVEL, owner, owner, fee, true);
        _fundAndApprove(player);
        deal(address(coin), player, 1_000e18);
        uint256 supplyBefore = coin.totalSupply();
        IForgeCoin.RunResult memory r = _run(player, 1, false, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(player);
        coin.settleRun(r, sig);

        uint256 burned = supplyBefore - coin.totalSupply();
        assertEq(coin.balanceOf(owner) + coin.seasonPool() + coin.treasuryBalance() + burned, fee);
        assertEq(coin.balanceOf(address(coin)), coin.seasonPool() + coin.treasuryBalance());
    }

    // ------------------------------------------------------------------ fuzz (SPEC §11)

    /// Fee split always sums to the full fee.
    function testFuzz_SplitFee_SumsToFee(uint256 fee) public view {
        fee = bound(fee, 0, type(uint128).max);
        (uint256 o, uint256 p, uint256 t) = coin.splitFee(fee);
        assertEq(o + p + t, fee);
        assertLe(o, fee * 7_000 / 10_000);
    }

    /// Supply never exceeds the cap whatever the number of faucet claims.
    function testFuzz_SupplyUnderCap(uint8 claims) public {
        for (uint256 i; i < claims; ++i) {
            vm.prank(address(uint160(0x1000 + i)));
            coin.claimFaucet();
        }
        assertLe(coin.totalSupply(), coin.cap());
        assertEq(coin.totalSupply(), uint256(claims) * 100e18);
    }

    // ------------------------------------------------------------------ races

    function _signRace(bytes32 roomId, address[] memory ranking) internal view returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(signerPk, coin.hashRaceResult(roomId, ranking));
        return abi.encodePacked(rr, s, v);
    }

    function test_Race_CreateJoinSettle_StakeEqualsPayout() public {
        _fundAndApprove(player);
        _fundAndApprove(player2);
        bytes32 room = keccak256("room-1");
        vm.prank(player);
        coin.createRaceRoom(room, LEVEL, 10e18);
        vm.prank(player2);
        coin.joinRace(room);
        assertEq(coin.balanceOf(address(coin)), 20e18);

        address[] memory ranking = new address[](2);
        ranking[0] = player2;
        ranking[1] = player;
        coin.settleRace(room, ranking, _signRace(room, ranking));

        assertEq(coin.balanceOf(player2), 90e18 + 12e18); // 60% of 20
        assertEq(coin.balanceOf(player), 90e18 + 5e18); // 25%
        assertEq(coin.balanceOf(owner), 2e18); // 10%
        assertEq(coin.seasonPool(), 1e18); // 5%
        assertEq(coin.balanceOf(address(coin)), coin.seasonPool() + coin.treasuryBalance());
    }

    function test_Race_RefundAfterTimeout() public {
        _fundAndApprove(player);
        bytes32 room = keccak256("room-2");
        vm.prank(player);
        coin.createRaceRoom(room, LEVEL, 10e18);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.RaceNotTimedOut.selector, room));
        coin.refundRace(room);
        vm.warp(block.timestamp + 1 hours + 1);
        coin.pause(); // refunds still work while paused
        coin.refundRace(room);
        assertEq(coin.balanceOf(player), 100e18);
    }

    // ------------------------------------------------------------------ constructor / admin: revert paths

    function test_Deploy_RevertsOnZeroSigner() public {
        vm.expectRevert(ForgeCoin.ZeroAddress.selector);
        new ForgeCoin(address(0));
    }

    function test_SetLevelNFT_RevertsOnZeroAddress() public {
        ForgeCoin fresh = new ForgeCoin(signer);
        vm.expectRevert(ForgeCoin.ZeroAddress.selector);
        fresh.setLevelNFT(ILevelNFT(address(0)));
    }

    function test_SetSigner_RevertsOnZeroAddress() public {
        vm.expectRevert(ForgeCoin.ZeroAddress.selector);
        coin.setSigner(address(0));
    }

    function test_WithdrawTreasury_RevertsOnZeroAddress() public {
        vm.expectRevert(ForgeCoin.ZeroAddress.selector);
        coin.withdrawTreasury(address(0));
    }

    function test_WithdrawTreasury_RevertsWhenEmpty() public {
        vm.expectRevert(ForgeCoin.NothingToWithdraw.selector);
        coin.withdrawTreasury(makeAddr("treasury"));
    }

    function test_RaceCreation_RevertsWhenLevelNFTNotSet() public {
        ForgeCoin fresh = new ForgeCoin(signer);
        vm.expectRevert(ForgeCoin.LevelNFTNotSet.selector);
        fresh.createRaceRoom(keccak256("room"), LEVEL, 1e18);
    }

    // ------------------------------------------------------------------ races: revert paths and 4-player payout

    function _funded(string memory label) internal returns (address p) {
        p = makeAddr(label);
        vm.prank(p);
        coin.claimFaucet();
    }

    function _openRace(bytes32 room, address creator, uint256 stake) internal {
        vm.prank(creator);
        coin.createRaceRoom(room, LEVEL, stake);
    }

    function test_Race_Create_RevertsOnZeroStake() public {
        vm.prank(_funded("a"));
        vm.expectRevert(ForgeCoin.ZeroStake.selector);
        coin.createRaceRoom(keccak256("r"), LEVEL, 0);
    }

    function test_Race_Create_RevertsWhenRoomExists() public {
        address a = _funded("a");
        bytes32 room = keccak256("r");
        _openRace(room, a, 10e18);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.RaceExists.selector, room));
        coin.createRaceRoom(room, LEVEL, 10e18);
    }

    function test_Race_Create_RevertsOnInactiveLevel() public {
        address a = _funded("a");
        mock.setActive(LEVEL, false);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.LevelInactive.selector, LEVEL));
        coin.createRaceRoom(keccak256("r"), LEVEL, 10e18);
    }

    function test_Race_Join_RevertsOnUnknownRoom() public {
        address b = _funded("b");
        bytes32 room = keccak256("nope");
        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.RaceNotOpen.selector, room));
        coin.joinRace(room);
    }

    function test_Race_Join_RevertsAfterTimeout() public {
        address a = _funded("a");
        address b = _funded("b");
        bytes32 room = keccak256("r");
        _openRace(room, a, 10e18);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(b);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.RaceTimedOut.selector, room));
        coin.joinRace(room);
    }

    function test_Race_Join_RevertsWhenAlreadyIn() public {
        address a = _funded("a");
        bytes32 room = keccak256("r");
        _openRace(room, a, 10e18);
        vm.prank(a);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.AlreadyInRace.selector, room, a));
        coin.joinRace(room);
    }

    function test_Race_Join_RevertsWhenFull() public {
        bytes32 room = keccak256("r");
        _openRace(room, _funded("p0"), 10e18);
        for (uint256 i = 1; i < coin.MAX_RACE_PLAYERS(); ++i) {
            address p = _funded(string.concat("p", vm.toString(i)));
            vm.prank(p);
            coin.joinRace(room);
        }
        address extra = _funded("extra");
        vm.prank(extra);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.RaceFull.selector, room));
        coin.joinRace(room);
    }

    function test_Race_Settle_RevertsWithSingleEntrant() public {
        address a = _funded("a");
        bytes32 room = keccak256("r");
        _openRace(room, a, 10e18);
        address[] memory ranking = new address[](2);
        ranking[0] = a;
        ranking[1] = player;
        bytes memory sig = _signRace(room, ranking);
        vm.expectRevert(ForgeCoin.InvalidRanking.selector);
        coin.settleRace(room, ranking, sig);
    }

    function test_Race_Settle_RevertsWithOutsider() public {
        address a = _funded("a");
        address b = _funded("b");
        bytes32 room = keccak256("r");
        _openRace(room, a, 10e18);
        vm.prank(b);
        coin.joinRace(room);
        address[] memory ranking = new address[](2);
        ranking[0] = a;
        ranking[1] = makeAddr("outsider");
        bytes memory sig = _signRace(room, ranking);
        vm.expectRevert(ForgeCoin.InvalidRanking.selector);
        coin.settleRace(room, ranking, sig);
    }

    function test_Race_Settle_RevertsWithDuplicateRank() public {
        address a = _funded("a");
        address b = _funded("b");
        bytes32 room = keccak256("r");
        _openRace(room, a, 10e18);
        vm.prank(b);
        coin.joinRace(room);
        address[] memory ranking = new address[](2);
        ranking[0] = a;
        ranking[1] = a;
        bytes memory sig = _signRace(room, ranking);
        vm.expectRevert(ForgeCoin.InvalidRanking.selector);
        coin.settleRace(room, ranking, sig);
    }

    function test_Race_Settle_RevertsWithBadSignatureOrTwice() public {
        address a = _funded("a");
        address b = _funded("b");
        bytes32 room = keccak256("r");
        _openRace(room, a, 10e18);
        vm.prank(b);
        coin.joinRace(room);
        address[] memory ranking = new address[](2);
        ranking[0] = b;
        ranking[1] = a;

        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(0xBAD, coin.hashRaceResult(room, ranking));
        vm.expectPartialRevert(ForgeCoin.InvalidSignature.selector);
        coin.settleRace(room, ranking, abi.encodePacked(rr, s, v));

        bytes memory good = _signRace(room, ranking);
        coin.settleRace(room, ranking, good);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.RaceNotOpen.selector, room));
        coin.settleRace(room, ranking, good);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.RaceNotOpen.selector, room));
        coin.refundRace(room); // a settled race can never be refunded
    }

    function test_Race_FourPlayers_StakeEqualsPayout() public {
        bytes32 room = keccak256("r4");
        address[] memory ps = new address[](4);
        for (uint256 i; i < 4; ++i) {
            ps[i] = _funded(string.concat("p", vm.toString(i)));
        }
        _openRace(room, ps[0], 10e18);
        for (uint256 i = 1; i < 4; ++i) {
            vm.prank(ps[i]);
            coin.joinRace(room);
        }
        assertEq(coin.getRace(room).players.length, 4);

        address[] memory ranking = new address[](4);
        ranking[0] = ps[3];
        ranking[1] = ps[2];
        ranking[2] = ps[1];
        ranking[3] = ps[0];
        coin.settleRace(room, ranking, _signRace(room, ranking));

        // pot = 40: 1st 24, 2nd 10, owner 4, pool 2. 3rd and 4th lose their stake.
        assertEq(coin.balanceOf(ps[3]), 90e18 + 24e18);
        assertEq(coin.balanceOf(ps[2]), 90e18 + 10e18);
        assertEq(coin.balanceOf(ps[1]), 90e18);
        assertEq(coin.balanceOf(ps[0]), 90e18);
        assertEq(coin.balanceOf(owner), 4e18);
        assertEq(coin.seasonPool(), 2e18);
        assertEq(coin.balanceOf(address(coin)), coin.seasonPool() + coin.treasuryBalance());
    }

    // ------------------------------------------------------------------ rewards and caps

    function test_SettleRun_DifficultyBonus_MaxOnFirstClearAfterFailure() public {
        mock.setLevel(LEVEL, owner, owner, 0, true);
        _fundAndApprove(player);
        _fundAndApprove(player2);
        IForgeCoin.RunResult memory fail = _run(player, 1, false, 1000);
        bytes memory sigFail = _signRun(signerPk, fail);
        vm.prank(player);
        coin.settleRun(fail, sigFail);

        IForgeCoin.RunResult memory win = _run(player2, 1, true, 5000);
        bytes memory sigWin = _signRun(signerPk, win);
        vm.prank(player2);
        coin.settleRun(win, sigWin);
        // 1 play, 0 clears: 5 + 45 = 50, + 20 first clear + 10 record = 80
        assertEq(coin.balanceOf(player2), 100e18 + 80e18);
    }

    function test_SettleRun_DailyCap_ClipsPartialReward() public {
        mock.setLevel(LEVEL, owner, owner, 0, true);
        _fundAndApprove(player);
        IForgeCoin.RunResult memory fail = _run(player, 1, false, 1000);
        bytes memory sigFail = _signRun(signerPk, fail);
        vm.prank(player);
        coin.settleRun(fail, sigFail);
        for (uint256 i = 2; i <= 10; ++i) {
            IForgeCoin.RunResult memory r = _run(player, i, true, uint32(100_000 - i));
            bytes memory sig = _signRun(signerPk, r);
            vm.prank(player);
            coin.settleRun(r, sig);
        }
        assertEq(coin.mintedOnDay(player, block.timestamp / 1 days), 200e18);
        assertEq(coin.balanceOf(player), 100e18 + 200e18);
    }

    function test_SettleRun_ClipsRewardAtSupplyCap() public {
        mock.setLevel(LEVEL, owner, owner, 0, true);
        _fundAndApprove(player);
        deal(address(coin), makeAddr("whale"), coin.cap() - 105e18, true);
        assertEq(coin.totalSupply(), coin.cap() - 5e18);

        IForgeCoin.RunResult memory r = _run(player, 1, true, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(player);
        coin.settleRun(r, sig);
        assertEq(coin.totalSupply(), coin.cap()); // 35 FORGE earned, only 5 left to mint
        assertEq(coin.balanceOf(player), 105e18);
    }

    function test_SettleRun_OwnerEarnsNoReward() public {
        _fundAndApprove(owner);
        IForgeCoin.RunResult memory r = _run(owner, 1, true, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(owner);
        coin.settleRun(r, sig);

        // pays 10, gets 70% back (7), and nothing is minted for the clear
        assertEq(coin.balanceOf(owner), 100e18 - 10e18 + 7e18);
        assertEq(coin.mintedOnDay(owner, block.timestamp / 1 days), 0);
        assertEq(coin.seasonPool(), 2e18); // the fee split still happens
        assertEq(mock.recordRunCalls(), 1); // LevelNFT still records the run
    }

    function test_SettleRun_CreatorWhoSoldTheLevelEarnsNoReward() public {
        address creator = makeAddr("creator");
        mock.setLevel(LEVEL, owner, creator, FEE, true); // creator != current owner
        _fundAndApprove(creator);
        IForgeCoin.RunResult memory r = _run(creator, 1, true, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(creator);
        coin.settleRun(r, sig);

        assertEq(coin.balanceOf(creator), 100e18 - 10e18); // paid the fee, no reward
        assertEq(coin.balanceOf(owner), 7e18);
    }

    function test_SettleRun_SelfPlayDoesNotConsumeFirstClearBonus() public {
        mock.setLevel(LEVEL, owner, owner, 0, true);
        _fundAndApprove(owner);
        _fundAndApprove(player);
        IForgeCoin.RunResult memory own = _run(owner, 1, true, 1000);
        bytes memory ownSig = _signRun(signerPk, own);
        vm.prank(owner);
        coin.settleRun(own, ownSig);
        (uint32 plays, uint32 clears, uint32 best) = coin.levelStats(LEVEL);
        assertEq(plays, 0);
        assertEq(clears, 0);
        assertEq(best, 0);

        IForgeCoin.RunResult memory other = _run(player, 1, true, 5000);
        bytes memory otherSig = _signRun(signerPk, other);
        vm.prank(player);
        coin.settleRun(other, otherSig);
        // still the first real clear: 5 base + 20 first clear + 10 record
        assertEq(coin.balanceOf(player), 100e18 + 35e18);
    }

    function _settleWithCoins(address p, uint256 nonce, uint16 coins) internal {
        IForgeCoin.RunResult memory r = _run(p, nonce, true, 1000);
        r.coins = coins;
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(p);
        coin.settleRun(r, sig);
    }

    function test_SettleRun_CoinBonus_PaysPerCoin() public {
        mock.setLevel(LEVEL, owner, owner, 0, true);
        _fundAndApprove(player);
        _settleWithCoins(player, 1, 12);
        // 5 base + 20 first clear + 10 record + 12 coins * 0.1
        assertEq(coin.balanceOf(player), 100e18 + 35e18 + 1.2e18);
    }

    function test_SettleRun_CoinBonus_IsCapped() public {
        mock.setLevel(LEVEL, owner, owner, 0, true);
        _fundAndApprove(player);
        _settleWithCoins(player, 1, type(uint16).max); // a hostile or buggy signer value
        assertEq(coin.balanceOf(player), 100e18 + 35e18 + coin.MAX_COIN_BONUS());
    }

    function test_SettleRun_CoinBonus_NotPaidOnFailedRun() public {
        mock.setLevel(LEVEL, owner, owner, 0, true);
        _fundAndApprove(player);
        IForgeCoin.RunResult memory r = _run(player, 1, false, 1000);
        r.coins = 40;
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(player);
        coin.settleRun(r, sig);
        assertEq(coin.balanceOf(player), 100e18); // dying with coins in hand earns nothing
    }

    /// The coin bonus can never push a reward above its own cap, whatever the signed value.
    function testFuzz_CoinBonus_NeverExceedsCap(uint16 coins) public {
        mock.setLevel(LEVEL, owner, owner, 0, true);
        _fundAndApprove(player);
        _settleWithCoins(player, 1, coins);
        uint256 gained = coin.balanceOf(player) - 100e18;
        assertLe(gained, 35e18 + coin.MAX_COIN_BONUS());
        assertGe(gained, 35e18);
    }

    // ------------------------------------------------------------------ seasons (closeSeason)

    function _signSeason(uint256 season_, address[] memory ps, address[] memory cs, uint256[] memory shares)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(signerPk, coin.hashSeasonResult(season_, ps, cs, shares));
        return abi.encodePacked(rr, s, v);
    }

    /// Plays one paid run so the season pool holds 2 FORGE, then jumps to the end of the season.
    function _seasonWithPool() internal {
        _fundAndApprove(player);
        IForgeCoin.RunResult memory r = _run(player, 1, false, 1000);
        bytes memory sig = _signRun(signerPk, r);
        vm.prank(player);
        coin.settleRun(r, sig);
        assertEq(coin.seasonPool(), 2e18);
        vm.warp(coin.seasonEnd());
    }

    function _winners() internal view returns (address[] memory ps, address[] memory cs, uint256[] memory sh) {
        ps = new address[](2);
        ps[0] = player;
        ps[1] = player2;
        cs = new address[](1);
        cs[0] = owner;
        sh = new uint256[](3);
        sh[0] = 5_000;
        sh[1] = 3_000;
        sh[2] = 2_000;
    }

    function test_CloseSeason_DistributesPoolAndStartsNextSeason() public {
        _seasonWithPool();
        (address[] memory ps, address[] memory cs, uint256[] memory sh) = _winners();
        bytes memory sig = _signSeason(1, ps, cs, sh);
        uint256 pBefore = coin.balanceOf(player);
        uint256 ownerBefore = coin.balanceOf(owner);

        coin.closeSeason(ps, cs, sh, sig);

        assertEq(coin.balanceOf(player), pBefore + 1e18); // 50% of 2
        assertEq(coin.balanceOf(player2), 0.6e18); // 30%
        assertEq(coin.balanceOf(owner), ownerBefore + 0.4e18); // 20%
        assertEq(coin.seasonPool(), 0);
        assertEq(coin.season(), 2);
        assertEq(coin.seasonEnd(), block.timestamp + 30 days);
    }

    function test_CloseSeason_RevertsBeforeSeasonEnd() public {
        (address[] memory ps, address[] memory cs, uint256[] memory sh) = _winners();
        bytes memory sig = _signSeason(1, ps, cs, sh);
        vm.expectRevert(abi.encodeWithSelector(ForgeCoin.SeasonNotOver.selector, coin.seasonEnd()));
        coin.closeSeason(ps, cs, sh, sig);
    }

    function test_CloseSeason_RevertsOnBadInput() public {
        _seasonWithPool();
        (address[] memory ps, address[] memory cs,) = _winners();

        uint256[] memory badTotal = new uint256[](3);
        badTotal[0] = 5_000;
        badTotal[1] = 3_000;
        badTotal[2] = 1_000; // sums to 9_000
        bytes memory sigTotal = _signSeason(1, ps, cs, badTotal);
        vm.expectRevert(ForgeCoin.InvalidSeasonInput.selector);
        coin.closeSeason(ps, cs, badTotal, sigTotal);

        uint256[] memory shortShares = new uint256[](2);
        shortShares[0] = 6_000;
        shortShares[1] = 4_000;
        bytes memory sigShort = _signSeason(1, ps, cs, shortShares);
        vm.expectRevert(ForgeCoin.InvalidSeasonInput.selector);
        coin.closeSeason(ps, cs, shortShares, sigShort);

        address[] memory many = new address[](11);
        uint256[] memory manyShares = new uint256[](11);
        for (uint256 i; i < 11; ++i) {
            many[i] = address(uint160(0x2000 + i));
        }
        bytes memory sigMany = _signSeason(1, many, new address[](0), manyShares);
        vm.expectRevert(ForgeCoin.InvalidSeasonInput.selector);
        coin.closeSeason(many, new address[](0), manyShares, sigMany);
    }

    function test_CloseSeason_RevertsOnBadSignatureOrNonAdmin() public {
        _seasonWithPool();
        (address[] memory ps, address[] memory cs, uint256[] memory sh) = _winners();

        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(0xBAD, coin.hashSeasonResult(1, ps, cs, sh));
        vm.expectPartialRevert(ForgeCoin.InvalidSignature.selector);
        coin.closeSeason(ps, cs, sh, abi.encodePacked(rr, s, v));

        bytes memory sig = _signSeason(1, ps, cs, sh);
        vm.prank(player);
        vm.expectPartialRevert(IAccessControl.AccessControlUnauthorizedAccount.selector);
        coin.closeSeason(ps, cs, sh, sig);
    }

    function test_CloseSeason_RevertsOnZeroAddressWinner() public {
        _seasonWithPool();
        (address[] memory ps, address[] memory cs, uint256[] memory sh) = _winners();
        ps[1] = address(0);
        bytes memory sig = _signSeason(1, ps, cs, sh);
        vm.expectRevert(ForgeCoin.ZeroAddress.selector);
        coin.closeSeason(ps, cs, sh, sig);
    }

    function test_CloseSeason_WithoutWinnersKeepsPool() public {
        _seasonWithPool();
        address[] memory none = new address[](0);
        uint256[] memory noShares = new uint256[](0);
        bytes memory sig = _signSeason(1, none, none, noShares);
        coin.closeSeason(none, none, noShares, sig);
        assertEq(coin.seasonPool(), 2e18); // nothing paid, pool rolls over
        assertEq(coin.season(), 2);
    }

    // TODO(studentB): settleRunWithPermit test (sign Permit with vm.sign), settleRace invalid ranking / outsider,
    //                 race full, closeSeason happy path + bad shares + before seasonEnd, supply-cap clipping,
    //                 invariant test "contract balance == seasonPool + treasury + open race escrow".
}
