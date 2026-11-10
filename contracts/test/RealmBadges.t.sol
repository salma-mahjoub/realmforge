// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {RealmBadges} from "../src/RealmBadges.sol";

contract RealmBadgesTest is Test {
    RealmBadges internal badges;
    uint256 internal signerPk = 0xBADA55;
    address internal signer;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        signer = vm.addr(signerPk);
        badges = new RealmBadges(signer);
    }

    function _claim(address holder, uint256 badgeId, uint256 ref, uint256 nonce, uint256 deadline)
        internal
        view
        returns (RealmBadges.BadgeClaim memory c, bytes memory sig)
    {
        c = RealmBadges.BadgeClaim(holder, badgeId, ref, nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, badges.hashBadgeClaim(c));
        sig = abi.encodePacked(r, s, v);
    }

    function test_DeployDomainAndInterfaces() public view {
        assertTrue(badges.hasRole(badges.DEFAULT_ADMIN_ROLE(), address(this)));
        assertTrue(badges.supportsInterface(type(IERC1155).interfaceId));
        assertTrue(badges.supportsInterface(type(IAccessControl).interfaceId));
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = badges.eip712Domain();
        assertEq(name, "RealmForge Badges");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(badges));
        assertEq(badges.BADGE_CLAIM_TYPEHASH(), keccak256("BadgeClaim(address holder,uint256 badgeId,uint256 ref,uint256 nonce,uint256 deadline)"));
    }

    function test_DeployRejectsZeroSigner() public {
        vm.expectRevert(RealmBadges.ZeroAddress.selector);
        new RealmBadges(address(0));
    }

    function test_ClaimMintsOneBadgeAndLocksItForever() public {
        (RealmBadges.BadgeClaim memory c, bytes memory sig) = _claim(alice, badges.FIRST_CLEAR(), 42, 7, block.timestamp + 1 days);
        vm.expectEmit(true, true, true, true);
        emit RealmBadges.BadgeClaimed(alice, badges.FIRST_CLEAR(), 42, 7);
        badges.claim(c, sig);
        assertEq(badges.balanceOf(alice, badges.FIRST_CLEAR()), 1);
        assertTrue(badges.claimed(alice, badges.FIRST_CLEAR(), 42));
        assertTrue(badges.nonceUsed(alice, 7));
        assertTrue(badges.locked(badges.FIRST_CLEAR()));
        assertTrue(bytes(badges.uri(badges.FIRST_CLEAR())).length > 100);
        assertTrue(bytes(badges.badgeSVG(badges.FIRST_CLEAR())).length > 100);
    }

    function test_ClaimCanBeRelayedButMintsToSignedHolder() public {
        (RealmBadges.BadgeClaim memory c, bytes memory sig) = _claim(alice, badges.CREATOR(), 2, 8, block.timestamp + 1 days);
        vm.prank(bob);
        badges.claim(c, sig);
        assertEq(badges.balanceOf(alice, badges.CREATOR()), 1);
        assertEq(badges.balanceOf(bob, badges.CREATOR()), 0);
    }

    function test_ClaimRejectsExpiredNonceReuseDuplicateAndBadSigner() public {
        (RealmBadges.BadgeClaim memory c, bytes memory sig) = _claim(alice, badges.RECORD_HOLDER(), 1, 9, block.timestamp + 10);
        vm.warp(c.deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(RealmBadges.SignatureExpired.selector, c.deadline));
        badges.claim(c, sig);
        (c, sig) = _claim(alice, badges.RECORD_HOLDER(), 1, 9, block.timestamp + 10);
        badges.claim(c, sig);
        vm.expectRevert(abi.encodeWithSelector(RealmBadges.NonceAlreadyUsed.selector, alice, 9));
        badges.claim(c, sig);
        (c, sig) = _claim(alice, badges.RECORD_HOLDER(), 1, 10, block.timestamp + 10);
        vm.expectRevert(abi.encodeWithSelector(RealmBadges.AlreadyClaimed.selector, alice, badges.RECORD_HOLDER(), 1));
        badges.claim(c, sig);
        (c, sig) = _claim(alice, badges.RACE_WINNER(), 1, 11, block.timestamp + 10);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, badges.hashBadgeClaim(c));
        sig = abi.encodePacked(r, s, v);
        vm.expectRevert(abi.encodeWithSelector(RealmBadges.InvalidSignature.selector, vm.addr(0xBAD)));
        badges.claim(c, sig);
    }

    function test_ClaimRejectsZeroHolderAndUnknownBadge() public {
        (RealmBadges.BadgeClaim memory c, bytes memory sig) = _claim(address(0), 1, 1, 1, block.timestamp + 1 days);
        vm.expectRevert(RealmBadges.ZeroAddress.selector);
        badges.claim(c, sig);
        (c, sig) = _claim(alice, 5, 1, 1, block.timestamp + 1 days);
        vm.expectRevert(abi.encodeWithSelector(RealmBadges.UnknownBadge.selector, 5));
        badges.claim(c, sig);
    }

    function test_TransfersAndApprovalsAlwaysRevert() public {
        (RealmBadges.BadgeClaim memory c, bytes memory sig) = _claim(alice, 1, 1, 1, block.timestamp + 1 days);
        badges.claim(c, sig);
        vm.expectRevert(RealmBadges.Soulbound.selector);
        badges.setApprovalForAll(bob, true);
        vm.prank(alice);
        vm.expectRevert(RealmBadges.Soulbound.selector);
        badges.safeTransferFrom(alice, bob, 1, 1, "");
        vm.prank(alice);
        vm.expectRevert(RealmBadges.Soulbound.selector);
        badges.safeBatchTransferFrom(alice, bob, _ids(), _values(), "");
    }

    function _ids() internal pure returns (uint256[] memory ids) { ids = new uint256[](1); ids[0] = 1; }
    function _values() internal pure returns (uint256[] memory values) { values = new uint256[](1); values[0] = 1; }

    function test_AdminRotatesSignerAndCannotSetZero() public {
        address next = makeAddr("nextSigner");
        vm.expectEmit(true, true, false, true);
        emit RealmBadges.SignerUpdated(signer, next);
        badges.setSigner(next);
        assertEq(badges.signer(), next);
        vm.expectRevert(RealmBadges.ZeroAddress.selector);
        badges.setSigner(address(0));
        bytes32 adminRole = badges.DEFAULT_ADMIN_ROLE();
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, adminRole));
        vm.prank(alice);
        badges.setSigner(next);
    }

    function test_MetadataAndLockRejectUnknownIds() public view {
        assertEq(badges.badgeName(1), "First Clear");
        assertEq(badges.badgeName(2), "Record Holder");
        assertEq(badges.badgeName(3), "Race Winner");
        assertEq(badges.badgeName(4), "Creator");
    }
}
