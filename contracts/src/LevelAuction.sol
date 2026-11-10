// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ILevelNFT} from "./interfaces/ILevelNFT.sol";

/// @dev The LevelNFT owner-only switch; the auction calls it while it is the escrow owner.
interface ILevelActive {
    function setActive(uint256 id, bool active) external;
}

/// @notice Timed English auctions for RealmForge level NFTs. ETH uses pull payments.
/// @dev A level is paused (LevelNFT.setActive(false)) while it is escrowed here: ForgeCoin pays the 70% owner share
///      to `ownerOf`, which would be this contract, and a fungible FORGE balance cannot be attributed to one level.
///      Pausing means no paid run can settle on an auctioned level, so nothing is ever stranded. The level's previous
///      active flag is restored before the NFT leaves escrow (settle or cancel).
///      Outgoing NFT transfers use `transferFrom`, not `safeTransferFrom`: a winning contract that rejects ERC-721
///      callbacks must not be able to block settlement.
contract LevelAuction is IERC721Receiver, ReentrancyGuard {
    struct Auction {
        address seller;
        address highestBidder;
        uint64 endTime;
        uint256 reservePrice;
        uint256 highestBid;
        uint256 minIncrement;
        bool settled;
        /// Active flag of the level before escrow, restored when it leaves.
        bool wasActive;
    }

    IERC721 public immutable levelNFT;
    IERC2981 public immutable royaltyNFT;
    uint64 public constant MIN_DURATION = 1 hours;
    uint64 public constant MAX_DURATION = 30 days;
    uint64 public constant EXTENSION_WINDOW = 10 minutes;
    uint64 public constant EXTENSION = 10 minutes;
    uint96 public constant MAX_ROYALTY_BPS = 500;
    mapping(uint256 => Auction) public auctions;
    mapping(address => uint256) public pendingReturns;

    error InvalidAddress();
    error InvalidAuction();
    error NotSeller();
    error AuctionNotActive();
    error BidTooLow(uint256 minimum);
    error SellerCannotBid();
    error AuctionNotEnded();
    error NoWinningBid();
    error NothingToWithdraw();
    error TransferFailed();
    error UnexpectedNFT();

    event AuctionCreated(
        uint256 indexed levelId, address indexed seller, uint256 reservePrice, uint256 minIncrement, uint64 endTime
    );
    event BidPlaced(uint256 indexed levelId, address indexed bidder, uint256 amount, uint64 endTime);
    event AuctionCancelled(uint256 indexed levelId);
    event AuctionSettled(
        uint256 indexed levelId,
        address indexed seller,
        address indexed winner,
        uint256 amount,
        uint256 royalty,
        address royaltyReceiver
    );
    event Withdrawal(address indexed account, uint256 amount);

    constructor(address nft, address forge) {
        if (nft == address(0) || forge == address(0)) revert InvalidAddress();
        levelNFT = IERC721(nft);
        royaltyNFT = IERC2981(nft);
        // Retained as a constructor dependency to bind deployment to the matching ForgeCoin instance.
        if (forge.code.length == 0) revert InvalidAddress();
    }

    function createAuction(uint256 id, uint256 reserve, uint256 increment, uint64 duration) external nonReentrant {
        if (reserve == 0 || increment == 0 || duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidAuction();
        if (auctions[id].seller != address(0) && !auctions[id].settled) revert InvalidAuction();
        if (levelNFT.ownerOf(id) != msg.sender) revert NotSeller();
        delete auctions[id];
        uint64 end = uint64(block.timestamp) + duration;
        (,,, bool active) = ILevelNFT(address(levelNFT)).levelInfo(id);
        auctions[id] = Auction(msg.sender, address(0), end, reserve, 0, increment, false, active);
        levelNFT.safeTransferFrom(msg.sender, address(this), id);
        if (active) ILevelActive(address(levelNFT)).setActive(id, false);
        emit AuctionCreated(id, msg.sender, reserve, increment, end);
    }

    function bid(uint256 id) external payable nonReentrant {
        Auction storage a = auctions[id];
        if (a.seller == address(0) || a.settled || block.timestamp >= a.endTime) revert AuctionNotActive();
        if (msg.sender == a.seller) revert SellerCannotBid();
        uint256 minimum = a.highestBid == 0 ? a.reservePrice : a.highestBid + a.minIncrement;
        if (msg.value < minimum) revert BidTooLow(minimum);
        if (a.highestBidder != address(0)) pendingReturns[a.highestBidder] += a.highestBid;
        a.highestBid = msg.value;
        a.highestBidder = msg.sender;
        if (a.endTime - block.timestamp <= EXTENSION_WINDOW) a.endTime = uint64(block.timestamp) + EXTENSION;
        emit BidPlaced(id, msg.sender, msg.value, a.endTime);
    }

    function cancelAuction(uint256 id) external nonReentrant {
        Auction storage a = auctions[id];
        if (a.seller != msg.sender) revert NotSeller();
        if (a.settled || a.highestBidder != address(0)) revert InvalidAuction();
        a.settled = true;
        _release(id, a.wasActive, a.seller);
        emit AuctionCancelled(id);
    }

    function settle(uint256 id) external nonReentrant {
        Auction storage a = auctions[id];
        if (a.seller == address(0) || a.settled || block.timestamp < a.endTime) revert AuctionNotEnded();
        if (a.highestBidder == address(0)) revert NoWinningBid();
        a.settled = true;
        (address receiver, uint256 royalty) = royaltyNFT.royaltyInfo(id, a.highestBid);
        if (royalty > a.highestBid * MAX_ROYALTY_BPS / 10_000) revert InvalidAuction();
        uint256 sellerAmount = a.highestBid - royalty;
        pendingReturns[a.seller] += sellerAmount;
        if (royalty != 0) pendingReturns[receiver] += royalty;
        _release(id, a.wasActive, a.highestBidder);
        emit AuctionSettled(id, a.seller, a.highestBidder, a.highestBid, royalty, receiver);
    }

    function _release(uint256 id, bool wasActive, address to) private {
        if (wasActive) ILevelActive(address(levelNFT)).setActive(id, true);
        levelNFT.transferFrom(address(this), to, id);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingReturns[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawal(msg.sender, amount);
    }


    function onERC721Received(address, address from, uint256 id, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(levelNFT) || from != auctions[id].seller) revert UnexpectedNFT();
        return IERC721Receiver.onERC721Received.selector;
    }
}
