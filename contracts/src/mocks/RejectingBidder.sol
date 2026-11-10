// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILevelAuctionBid {
    function bid(uint256 id) external payable;
    function withdraw() external;
}

contract RejectingBidder {
    function placeBid(address auction, uint256 id) external payable {
        ILevelAuctionBid(auction).bid{value: msg.value}(id);
    }

    function withdraw(address auction) external {
        ILevelAuctionBid(auction).withdraw();
    }

    receive() external payable { revert("reject ETH"); }
}
