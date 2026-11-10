// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LevelNFT} from "../src/LevelNFT.sol";
import {LevelAuction} from "../src/LevelAuction.sol";
import {ForgeCoin} from "../src/ForgeCoin.sol";
import {IForgeCoin} from "../src/interfaces/IForgeCoin.sol";
import {RejectingBidder} from "../src/mocks/RejectingBidder.sol";

/// A winner contract with no onERC721Received: a safeTransferFrom to it would revert.
contract NoReceiverBidder {
    function placeBid(address auction, uint256 id) external payable {
        LevelAuction(auction).bid{value: msg.value}(id);
    }
}

contract LevelAuctionTest is Test {
    LevelNFT nft;
    LevelAuction auction;
    ForgeCoin coin;
    address seller = makeAddr("seller");
    address buyer = makeAddr("buyer");
    address buyer2 = makeAddr("buyer2");
    address player = makeAddr("player");
    uint256 signerPk = 0xA11CE;

    function setUp() public {
        nft = new LevelNFT(vm.addr(signerPk));
        coin = new ForgeCoin(vm.addr(signerPk));
        coin.setLevelNFT(nft);
        nft.grantRole(nft.GAME_ROLE(), address(coin));
        auction = new LevelAuction(address(nft), address(coin));
        uint256 deadline = block.timestamp + 1 days;
        bytes32 hash = keccak256("auction test level");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, nft.hashClearProof(seller, hash, deadline));
        vm.prank(seller);
        nft.publish(hash, "ipfs://level", 1e18, 0, deadline, abi.encodePacked(r, s, v));
        vm.deal(seller, 5 ether);
        vm.deal(buyer, 5 ether);
        vm.deal(buyer2, 5 ether);
    }

    function _start(address from) internal {
        vm.startPrank(from);
        nft.approve(address(auction), 1);
        auction.createAuction(1, 1 ether, 0.1 ether, 1 hours);
        vm.stopPrank();
    }

    function _endTime() internal view returns (uint64 endTime) {
        (,, endTime,,,,,) = auction.auctions(1);
    }

    function _active() internal view returns (bool active) {
        (,,, active) = nft.levelInfo(1);
    }

    function test_EnglishAuctionRoyaltyAndAntiSnipe() public {
        _start(seller);
        assertEq(nft.ownerOf(1), address(auction));
        vm.warp(block.timestamp + 55 minutes);
        vm.prank(buyer);
        auction.bid{value: 1 ether}(1);
        assertEq(_endTime(), block.timestamp + 10 minutes, "a bid in the last 10 min extends the auction");
        vm.warp(_endTime());
        auction.settle(1);
        assertEq(nft.ownerOf(1), buyer);
        // seller is also the creator: 95% proceeds + 5% royalty
        assertEq(auction.pendingReturns(seller), 1 ether);
    }

    function test_RoyaltyGoesToCreatorWhenSellerIsNotCreator() public {
        vm.prank(seller);
        nft.transferFrom(seller, buyer2, 1);
        _start(buyer2);
        vm.prank(buyer);
        auction.bid{value: 2 ether}(1);
        vm.warp(_endTime());
        auction.settle(1);
        assertEq(auction.pendingReturns(buyer2), 1.9 ether, "seller gets 95%");
        assertEq(auction.pendingReturns(seller), 0.1 ether, "creator gets the 5% ERC-2981 royalty");
        uint256 before = buyer2.balance;
        vm.prank(buyer2);
        auction.withdraw();
        assertEq(buyer2.balance - before, 1.9 ether);
        vm.expectRevert(LevelAuction.NothingToWithdraw.selector);
        vm.prank(buyer2);
        auction.withdraw();
    }

    function test_BidRules() public {
        _start(seller);
        vm.expectRevert(abi.encodeWithSelector(LevelAuction.BidTooLow.selector, 1 ether));
        vm.prank(buyer);
        auction.bid{value: 0.5 ether}(1);
        vm.expectRevert(LevelAuction.SellerCannotBid.selector);
        vm.prank(seller);
        auction.bid{value: 1 ether}(1);
        vm.prank(buyer);
        auction.bid{value: 1 ether}(1);
        vm.expectRevert(abi.encodeWithSelector(LevelAuction.BidTooLow.selector, 1.1 ether));
        vm.prank(buyer2);
        auction.bid{value: 1.05 ether}(1);
        vm.expectRevert(LevelAuction.AuctionNotEnded.selector);
        auction.settle(1);
        vm.expectRevert(LevelAuction.InvalidAuction.selector);
        vm.prank(seller);
        auction.cancelAuction(1);
        vm.warp(_endTime());
        vm.expectRevert(LevelAuction.AuctionNotActive.selector);
        vm.prank(buyer2);
        auction.bid{value: 2 ether}(1);
    }

    function test_OutbidAndSettleDoNotCallRejectingBidder() public {
        RejectingBidder bad = new RejectingBidder();
        _start(seller);
        bad.placeBid{value: 1 ether}(address(auction), 1);
        vm.prank(buyer);
        auction.bid{value: 1.1 ether}(1);
        assertEq(auction.pendingReturns(address(bad)), 1 ether, "outbid refund is pulled, never pushed");
        vm.warp(_endTime());
        auction.settle(1);
        assertEq(nft.ownerOf(1), buyer);
    }

    function test_WinnerWithoutERC721ReceiverStillSettles() public {
        NoReceiverBidder winner = new NoReceiverBidder();
        _start(seller);
        winner.placeBid{value: 1 ether}(address(auction), 1);
        vm.warp(_endTime());
        auction.settle(1);
        assertEq(nft.ownerOf(1), address(winner));
    }

    function test_CancelOnlyBeforeBidAndRestoresLevel() public {
        _start(seller);
        assertFalse(_active(), "paused while escrowed");
        vm.prank(seller);
        auction.cancelAuction(1);
        assertEq(nft.ownerOf(1), seller);
        assertTrue(_active(), "restored on cancel");
    }

    function test_LevelPausedDuringEscrowSoNoPlayFeeIsStranded() public {
        _start(seller);
        vm.prank(player);
        coin.claimFaucet();
        vm.prank(player);
        coin.approve(address(coin), type(uint256).max);
        IForgeCoin.RunResult memory result = IForgeCoin.RunResult(player, 1, 1_000, true, 0, 1, block.timestamp + 1 days);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, coin.hashRunResult(result));
        vm.expectRevert();
        vm.prank(player);
        coin.settleRun(result, abi.encodePacked(r, s, v));
        assertEq(coin.balanceOf(address(auction)), 0);

        vm.prank(buyer);
        auction.bid{value: 1 ether}(1);
        vm.warp(_endTime());
        auction.settle(1);
        assertTrue(_active(), "active again for the new owner");
        result.deadline = block.timestamp + 1 days;
        (v, r, s) = vm.sign(signerPk, coin.hashRunResult(result));
        vm.prank(player);
        coin.settleRun(result, abi.encodePacked(r, s, v));
        assertEq(coin.balanceOf(buyer), 0.7e18, "new owner earns the 70% share");
    }

    function test_AlreadyInactiveLevelStaysInactive() public {
        vm.prank(seller);
        nft.setActive(1, false);
        _start(seller);
        vm.prank(seller);
        auction.cancelAuction(1);
        assertFalse(_active(), "the auction restores the previous flag, it does not force-activate");
    }

    function test_OnlyOwnerCanStartAndOnlyEscrowedNftsAccepted() public {
        vm.prank(seller);
        nft.approve(address(auction), 1);
        vm.expectRevert(LevelAuction.NotSeller.selector);
        vm.prank(buyer);
        auction.createAuction(1, 1 ether, 0.1 ether, 1 hours);
        vm.expectRevert(LevelAuction.UnexpectedNFT.selector);
        vm.prank(seller);
        nft.safeTransferFrom(seller, address(auction), 1);
    }
}
