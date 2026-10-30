// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

import {LevelNFT} from "../src/LevelNFT.sol";

/// @title LevelNFT unit + fuzz tests (Student A) — run with `npx hardhat test solidity`
contract LevelNFTTest is Test {
    LevelNFT internal nft;

    uint256 internal signerPk = 0xA11CE;
    address internal signer;
    address internal admin = address(this);
    address internal alice = makeAddr("alice"); // creator
    address internal bob = makeAddr("bob"); // buyer / remixer
    address internal game = makeAddr("game"); // stands in for ForgeCoin

    bytes32 internal constant LAYOUT = keccak256("level-1");
    string internal constant URI = "ipfs://bafy-level-1";

    function setUp() public {
        signer = vm.addr(signerPk);
        nft = new LevelNFT(signer);
        nft.grantRole(nft.GAME_ROLE(), game);
        vm.deal(bob, 100 ether);
    }

    // ------------------------------------------------------------------ helpers

    function _sign(uint256 pk, address creator, bytes32 layout, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, nft.hashClearProof(creator, layout, deadline));
        return abi.encodePacked(r, s, v);
    }

    function _publish(address creator, bytes32 layout, uint96 fee, uint256 parentId) internal returns (uint256 id) {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, creator, layout, deadline);
        vm.prank(creator);
        id = nft.publish(layout, URI, fee, parentId, deadline, sig);
    }

    // ------------------------------------------------------------------ deploy / roles

    function test_Deploy_RolesAndMetadata() public view {
        assertTrue(nft.hasRole(nft.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(nft.hasRole(nft.SIGNER_ROLE(), signer));
        assertTrue(nft.hasRole(nft.GAME_ROLE(), game));
        assertEq(nft.nextId(), 1);
        assertEq(nft.name(), "RealmForge Level");
        assertEq(nft.MAX_PLAY_FEE(), 100e18);
        assertEq(nft.REMIX_ROYALTY_BPS(), 500);
    }

    function test_Deploy_RevertsOnZeroSigner() public {
        vm.expectRevert(LevelNFT.ZeroAddress.selector);
        new LevelNFT(address(0));
    }

    function test_SupportsInterface() public view {
        assertTrue(nft.supportsInterface(type(IERC721).interfaceId));
        assertTrue(nft.supportsInterface(type(IERC2981).interfaceId));
        assertTrue(nft.supportsInterface(type(IAccessControl).interfaceId));
        assertTrue(nft.supportsInterface(0x49064906)); // ERC-4906 (metadata update, from URIStorage)
        assertFalse(nft.supportsInterface(0xdeadbeef));
    }

    function test_Eip712Domain() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = nft.eip712Domain();
        assertEq(name, "RealmForge LevelNFT");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(verifying, address(nft));
        assertEq(
            nft.CLEAR_PROOF_TYPEHASH(), keccak256("ClearProof(address creator,bytes32 layoutHash,uint256 deadline)")
        );
    }

    // ------------------------------------------------------------------ publish

    function test_Publish_Mints() public {
        uint256 id = _publish(alice, LAYOUT, 1e18, 0);
        assertEq(id, 1);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.tokenURI(1), URI);
        assertTrue(nft.hashUsed(LAYOUT));
        (address owner, address creator, uint96 fee, bool active) = nft.levelInfo(1);
        assertEq(owner, alice);
        assertEq(creator, alice);
        assertEq(fee, 1e18);
        assertTrue(active);
        (address receiver, uint256 royalty) = nft.royaltyInfo(1, 1 ether);
        assertEq(receiver, alice);
        assertEq(royalty, 0.05 ether);
    }

    function test_Publish_RevertsWrongSigner() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(0xBAD, alice, LAYOUT, deadline);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.InvalidSigner.selector, vm.addr(0xBAD)));
        nft.publish(LAYOUT, URI, 0, 0, deadline, sig);
    }

    function test_Publish_RevertsWhenSenderIsNotSignedCreator() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, alice, LAYOUT, deadline);
        vm.prank(bob); // proof is bound to alice
        vm.expectRevert();
        nft.publish(LAYOUT, URI, 0, 0, deadline, sig);
    }

    function test_Publish_RevertsExpired() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, alice, LAYOUT, deadline);
        vm.warp(deadline + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.ProofExpired.selector, deadline));
        nft.publish(LAYOUT, URI, 0, 0, deadline, sig);
    }

    function test_Publish_RevertsReplayAndDuplicateLayout() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, alice, LAYOUT, deadline);
        vm.startPrank(alice);
        nft.publish(LAYOUT, URI, 0, 0, deadline, sig);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.LayoutAlreadyUsed.selector, LAYOUT));
        nft.publish(LAYOUT, URI, 0, 0, deadline, sig);
        vm.stopPrank();
    }

    function test_Publish_RevertsFeeAboveCap() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, alice, LAYOUT, deadline);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.PlayFeeTooHigh.selector, uint96(101e18), uint96(100e18)));
        nft.publish(LAYOUT, URI, 101e18, 0, deadline, sig);
    }

    function test_Publish_RevertsUnknownParent() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(signerPk, alice, LAYOUT, deadline);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.ParentNotFound.selector, 42));
        nft.publish(LAYOUT, URI, 0, 42, deadline, sig);
    }

    // ------------------------------------------------------------------ owner functions

    function test_SetPlayFee_SetActive_Like() public {
        _publish(alice, LAYOUT, 1e18, 0);
        vm.startPrank(alice);
        nft.setPlayFee(1, 2e18);
        nft.setActive(1, false);
        vm.stopPrank();
        (,, uint96 fee, bool active) = nft.levelInfo(1);
        assertEq(fee, 2e18);
        assertFalse(active);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.NotTokenOwner.selector, 1, bob));
        nft.setPlayFee(1, 0);

        vm.startPrank(bob);
        nft.like(1);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.AlreadyLiked.selector, 1, bob));
        nft.like(1);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ recordRun

    function test_RecordRun_OnlyGame() public {
        _publish(alice, LAYOUT, 0, 0);
        bytes32 gameRole = nft.GAME_ROLE(); // read before prank: view calls consume vm.prank
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, bob, gameRole));
        nft.recordRun(1, bob, 1000, true);
    }

    function test_RecordRun_UpdatesStatsAndRecord() public {
        _publish(alice, LAYOUT, 0, 0);
        vm.startPrank(game);
        nft.recordRun(1, bob, 9000, false);
        nft.recordRun(1, bob, 8000, true);
        nft.recordRun(1, alice, 9000, true); // slower: no record
        vm.stopPrank();
        (,,,, uint32 plays, uint32 clears,, uint32 best, address bestPlayer,) = nft.levels(1);
        assertEq(plays, 3);
        assertEq(clears, 2);
        assertEq(best, 8000);
        assertEq(bestPlayer, bob);
    }

    // ------------------------------------------------------------------ market

    function test_ListBuyWithdraw_RoyaltyAndPull() public {
        _publish(alice, LAYOUT, 0, 0);
        vm.prank(alice);
        nft.list(1, 1 ether);
        vm.prank(bob);
        nft.buy{value: 1 ether}(1);

        assertEq(nft.ownerOf(1), bob);
        assertEq(nft.listingPrice(1), 0);
        // alice is both creator (5%) and seller (95%)
        assertEq(nft.pendingWithdrawals(alice), 1 ether);

        uint256 before = alice.balance;
        vm.prank(alice);
        nft.withdraw();
        assertEq(alice.balance - before, 1 ether);
        vm.prank(alice);
        vm.expectRevert(LevelNFT.NothingToWithdraw.selector);
        nft.withdraw();
    }

    function test_Buy_RemixSplitsRoyaltyWithParent() public {
        _publish(alice, LAYOUT, 0, 0); // id 1 by alice
        uint256 remix = _publish(bob, keccak256("remix"), 0, 1); // id 2 by bob, parent 1
        address carol = makeAddr("carol");
        vm.deal(carol, 10 ether);
        vm.prank(bob);
        nft.list(remix, 1 ether);
        vm.prank(carol);
        nft.buy{value: 1 ether}(remix);
        assertEq(nft.pendingWithdrawals(alice), 0.025 ether); // parent creator: half of 5%
        assertEq(nft.pendingWithdrawals(bob), 0.975 ether); // creator half + seller 95%
    }

    function test_Buy_RevertsWrongPaymentAndUnlisted() public {
        _publish(alice, LAYOUT, 0, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.NotListed.selector, 1));
        nft.buy{value: 1 ether}(1);
        vm.prank(alice);
        nft.list(1, 1 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(LevelNFT.WrongPayment.selector, 0.5 ether, 1 ether));
        nft.buy{value: 0.5 ether}(1);
    }

    function test_Transfer_ClearsListing() public {
        _publish(alice, LAYOUT, 0, 0);
        vm.startPrank(alice);
        nft.list(1, 1 ether);
        nft.transferFrom(alice, bob, 1);
        vm.stopPrank();
        assertEq(nft.listingPrice(1), 0);
    }

    /// Fuzz: seller proceeds + royalties always equal the price (no ETH created or lost).
    function testFuzz_Buy_PayoutsSumToPrice(uint96 price) public {
        vm.assume(price > 0);
        _publish(alice, LAYOUT, 0, 0);
        uint256 remix = _publish(bob, keccak256("remix"), 0, 1);
        address carol = makeAddr("carol");
        vm.deal(carol, uint256(price));
        vm.prank(bob);
        nft.list(remix, price);
        vm.prank(carol);
        nft.buy{value: price}(remix);
        assertEq(nft.pendingWithdrawals(alice) + nft.pendingWithdrawals(bob), price);
        assertEq(address(nft).balance, price);
    }

    // TODO(studentA): reentrancy test on withdraw() with a malicious receiver contract,
    //                 safeTransferFrom to a non-receiver, levelInfo on a non-existent id, gas snapshots.
}
