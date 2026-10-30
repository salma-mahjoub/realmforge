// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {ForgeCoin} from "../src/ForgeCoin.sol";
import {IForgeCoin} from "../src/interfaces/IForgeCoin.sol";
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
            coins: 3,
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
        assertEq(coin.treasuryBalance(), 1e18); // 10%
        assertEq(coin.balanceOf(address(coin)), 3e18);
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
        assertEq(coin.balanceOf(treasury), 1e18);
        assertEq(coin.treasuryBalance(), 0);
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

    // TODO(studentB): settleRunWithPermit test (sign Permit with vm.sign), settleRace invalid ranking / outsider,
    //                 race full, closeSeason happy path + bad shares + before seasonEnd, supply-cap clipping,
    //                 invariant test "contract balance == seasonPool + treasury + open race escrow".
}
