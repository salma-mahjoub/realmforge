// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ILevelNFT} from "../src/interfaces/ILevelNFT.sol";
import {LevelBounty} from "../src/LevelBounty.sol";

contract BountyToken is ERC20 {
    constructor() ERC20("Forge", "FORGE") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract BountyLevels is ILevelNFT {
    mapping(uint256 => address[2]) private owners;
    function set(uint256 id, address owner, address creator) external { owners[id] = [owner, creator]; }
    function levelInfo(uint256 id) external view returns (address owner, address creator, uint96 playFee, bool active) {
        owner = owners[id][0]; creator = owners[id][1]; require(owner != address(0), "unknown"); return (owner, creator, 0, true);
    }
    function recordRun(uint256, address, uint32, bool) external pure {}
}

contract LevelBountyTest is Test {
    uint256 signerPk = 0xB0A17;
    address signer;
    address creator = makeAddr("creator");
    address sponsor1 = makeAddr("sponsor1");
    address sponsor2 = makeAddr("sponsor2");
    address player = makeAddr("player");
    BountyToken token;
    BountyLevels nft;
    LevelBounty bounty;

    function setUp() public {
        signer = vm.addr(signerPk);
        token = new BountyToken();
        nft = new BountyLevels();
        nft.set(1, creator, creator);
        bounty = new LevelBounty(token, nft, signer);
        token.mint(sponsor1, 100 ether);
        token.mint(sponsor2, 100 ether);
        vm.prank(sponsor1); token.approve(address(bounty), type(uint256).max);
        vm.prank(sponsor2); token.approve(address(bounty), type(uint256).max);
    }

    function _create(uint32 target, uint64 expiry) internal returns (uint256) {
        vm.prank(sponsor1); return bounty.createBounty(1, 10 ether, target, expiry);
    }
    function _claimSig(uint256 id, address who, uint32 timeMs, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        LevelBounty.BountyClaim memory c = LevelBounty.BountyClaim(id, 1, who, timeMs, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, bounty.hashBountyClaim(c));
        return abi.encodePacked(r, s, v);
    }
    function _signClaim(uint256 pk, LevelBounty.BountyClaim memory c) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, bounty.hashBountyClaim(c));
        return abi.encodePacked(r, s, v);
    }

    function test_DeployRejectsZeroAddresses() public {
        vm.expectRevert(LevelBounty.ZeroAddress.selector); new LevelBounty(token, nft, address(0));
        vm.expectRevert(LevelBounty.ZeroAddress.selector); new LevelBounty(token, ILevelNFT(address(0)), signer);
        vm.expectRevert(LevelBounty.ZeroAddress.selector); new LevelBounty(ERC20(address(0)), nft, signer);
    }

    function test_CreateAndTopUpByMultipleSponsors() public {
        uint256 id = _create(20_000, uint64(block.timestamp + 1 days));
        vm.prank(sponsor2); bounty.topUp(id, 5 ether);
        LevelBounty.Bounty memory b = bounty.getBounty(id);
        assertEq(id, 1); assertEq(b.levelId, 1); assertEq(b.amount, 15 ether); assertEq(b.targetTimeMs, 20_000);
        assertEq(bounty.contributions(id, sponsor1), 10 ether); assertEq(bounty.contributions(id, sponsor2), 5 ether);
    }

    function test_ClaimPaysOnceAndBeatsTarget() public {
        uint256 id = _create(20_000, 0);
        vm.prank(sponsor2); bounty.topUp(id, 5 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _claimSig(id, player, 19_999, 1, deadline);
        vm.prank(player); bounty.claim(LevelBounty.BountyClaim(id, 1, player, 19_999, 1, deadline), sig);
        assertEq(token.balanceOf(player), 15 ether);
        assertEq(uint8(bounty.getBounty(id).status), uint8(LevelBounty.Status.Claimed));
        LevelBounty.BountyClaim memory second = LevelBounty.BountyClaim(id, 1, player, 19_999, 2, deadline);
        bytes memory secondSig = _claimSig(id, player, 19_999, 2, deadline);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.BountyNotOpen.selector, id));
        bounty.claim(second, secondSig);
    }

    function test_ClaimRejectsTargetOwnerCreatorAndSponsor() public {
        uint256 id = _create(1000, 0);
        uint256 deadline = block.timestamp + 1 hours;
        LevelBounty.BountyClaim memory slow = LevelBounty.BountyClaim(id, 1, player, 1001, 1, deadline);
        bytes memory slowSig = _claimSig(id, player, 1001, 1, deadline);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.TargetNotBeaten.selector, 1000, 1001)); bounty.claim(slow, slowSig);
        LevelBounty.BountyClaim memory ownerClaim = LevelBounty.BountyClaim(id, 1, creator, 500, 2, deadline);
        bytes memory ownerSig = _claimSig(id, creator, 500, 2, deadline);
        vm.prank(creator); vm.expectRevert(abi.encodeWithSelector(LevelBounty.IneligiblePlayer.selector, creator)); bounty.claim(ownerClaim, ownerSig);
        LevelBounty.BountyClaim memory sponsorClaim = LevelBounty.BountyClaim(id, 1, sponsor1, 500, 3, deadline);
        bytes memory sponsorSig = _claimSig(id, sponsor1, 500, 3, deadline);
        vm.prank(sponsor1); vm.expectRevert(abi.encodeWithSelector(LevelBounty.IneligiblePlayer.selector, sponsor1)); bounty.claim(sponsorClaim, sponsorSig);
    }

    function test_RefundEachSponsorAfterExpiry() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 id = _create(0, expiry);
        vm.prank(sponsor2); bounty.topUp(id, 5 ether);
        vm.warp(expiry);
        vm.prank(sponsor1); bounty.refund(id);
        vm.prank(sponsor2); bounty.refund(id);
        assertEq(token.balanceOf(sponsor1), 100 ether); assertEq(token.balanceOf(sponsor2), 100 ether);
        assertEq(bounty.getBounty(id).amount, 0);
    }

    function test_RevertsInvalidExpiryAndZeroAmountAndUnknownLevel() public {
        vm.prank(sponsor1); vm.expectRevert(LevelBounty.ZeroAmount.selector); bounty.createBounty(1, 0, 0, 0);
        vm.prank(sponsor1); vm.expectRevert(); bounty.createBounty(9, 1, 0, 0);
        vm.prank(sponsor1); vm.expectRevert(abi.encodeWithSelector(LevelBounty.InvalidExpiry.selector, uint64(block.timestamp)));
        bounty.createBounty(1, 1, 0, uint64(block.timestamp));
    }

    function test_TopUpAndRefundRejectInvalidStates() public {
        vm.prank(sponsor2); vm.expectRevert(abi.encodeWithSelector(LevelBounty.BountyNotFound.selector, 55)); bounty.topUp(55, 1 ether);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.BountyNotFound.selector, 55)); bounty.refund(55);
        uint256 id = _create(0, uint64(block.timestamp + 1 days));
        vm.prank(sponsor2); vm.expectRevert(LevelBounty.ZeroAmount.selector); bounty.topUp(id, 0);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.BountyNotExpired.selector, id)); bounty.refund(id);
        vm.warp(block.timestamp + 1 days);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.NothingToRefund.selector, id, player)); bounty.refund(id);
        vm.prank(sponsor2); vm.expectRevert(abi.encodeWithSelector(LevelBounty.BountyExpired.selector, id)); bounty.topUp(id, 1 ether);
    }

    function test_ClaimRejectsWrongCallerExpiredSignatureNonceAndSigner() public {
        uint256 id = _create(0, 0); uint256 deadline = block.timestamp + 1;
        LevelBounty.BountyClaim memory c = LevelBounty.BountyClaim(id, 1, player, 100, 7, deadline);
        bytes memory sig = _claimSig(id, player, 100, 7, deadline);
        vm.prank(sponsor2); vm.expectRevert(abi.encodeWithSelector(LevelBounty.NotClaimPlayer.selector, sponsor2, player)); bounty.claim(c, sig);
        vm.warp(deadline + 1); vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.SignatureExpired.selector, deadline)); bounty.claim(c, sig);
        vm.warp(deadline - 1); vm.prank(player); bounty.claim(c, sig);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.NonceAlreadyUsed.selector, player, 7)); bounty.claim(c, sig);
        uint256 nextDeadline = block.timestamp + 1 hours;
        uint256 openId = _create(0, 0);
        LevelBounty.BountyClaim memory badClaim = LevelBounty.BountyClaim(openId, 2, player, 100, 8, nextDeadline);
        bytes memory bad = _signClaim(signerPk, badClaim);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.LevelMismatch.selector, 1, 2)); bounty.claim(badClaim, bad);
        bytes memory wrongSigner = _signClaim(0xBAD, badClaim);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.InvalidSigner.selector, vm.addr(0xBAD))); bounty.claim(badClaim, wrongSigner);
        LevelBounty.BountyClaim memory missing = LevelBounty.BountyClaim(123, 1, player, 100, 9, nextDeadline);
        bytes memory missingSig = _signClaim(signerPk, missing);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.BountyNotFound.selector, 123)); bounty.claim(missing, missingSig);
    }

    function test_ClaimAfterExpiryAndIsExpiredView() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        uint256 id = _create(0, expiry);
        assertFalse(bounty.isExpired(id));
        vm.warp(expiry);
        assertTrue(bounty.isExpired(id));
        uint256 deadline = block.timestamp + 1 hours;
        LevelBounty.BountyClaim memory c = LevelBounty.BountyClaim(id, 1, player, 100, 1, deadline);
        bytes memory sig = _claimSig(id, player, 100, 1, deadline);
        vm.prank(player); vm.expectRevert(abi.encodeWithSelector(LevelBounty.BountyExpired.selector, id)); bounty.claim(c, sig);
    }
}
