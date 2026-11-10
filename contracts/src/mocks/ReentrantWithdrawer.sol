// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILevelMarket {
    function list(uint256 id, uint256 priceWei) external;
    function withdraw() external;
}

/// @title ReentrantWithdrawer — malicious seller used to prove {LevelNFT.withdraw} is reentrancy-safe
/// @notice Owns a level, lists it, and when paid out tries to call `withdraw()` again from `receive()`.
/// @dev NOT for deployment. With `attack = false` it behaves like an honest contract wallet (control case).
contract ReentrantWithdrawer {
    ILevelMarket public immutable market;
    bool public attack = true;
    uint256 public reentries;

    constructor(address market_) {
        market = ILevelMarket(market_);
    }

    function setAttack(bool on) external {
        attack = on;
    }

    function listLevel(uint256 id, uint256 priceWei) external {
        market.list(id, priceWei);
    }

    function cashOut() external {
        market.withdraw();
    }

    receive() external payable {
        if (attack) {
            reentries++;
            market.withdraw(); // must revert (nonReentrant), which makes the outer transfer fail
        }
    }
}
