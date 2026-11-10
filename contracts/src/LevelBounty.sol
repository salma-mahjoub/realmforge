// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {ILevelNFT} from "./interfaces/ILevelNFT.sol";

/// @title LevelBounty — FORGE bounties on RealmForge levels
/// @notice Anyone escrows FORGE on a level ("first to clear it under 30 s wins 50 FORGE"). The first player
///         who proves a qualifying clear with a server-signed EIP-712 `BountyClaim` takes the whole pot.
///         Other sponsors may top a bounty up; if it expires unclaimed, every sponsor pulls back exactly
///         what they put in.
/// @dev Bases: AccessControl, ReentrancyGuard, EIP712 (OpenZeppelin v5). Same trust model as LevelNFT /
///      ForgeCoin: the game server validates the run off-chain and a SIGNER_ROLE key signs the result.
///      EIP-712 domain: name "RealmForge LevelBounty", version "1", chainId, verifyingContract = this.
///      ForgeCoin and LevelNFT are untouched: this contract only uses ERC-20 `transferFrom`/`transfer` and the
///      frozen `ILevelNFT.levelInfo`.
contract LevelBounty is AccessControl, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    // =====================================================================================================
    //                                              TYPES
    // =====================================================================================================

    /// @notice Lifecycle of a bounty. An expired, unclaimed bounty stays `Open` while sponsors refund.
    enum Status {
        None,
        Open,
        Claimed
    }

    /// @notice One bounty. `amount` is what is still escrowed (it drops as sponsors refund after expiry).
    struct Bounty {
        uint256 levelId;
        address sponsor; // who created it (first sponsor)
        uint32 targetTimeMs; // 0 = any clear qualifies; otherwise timeMs must be <= target
        uint64 expiry; // unix seconds; 0 = never expires (then it can never be refunded)
        Status status;
        uint256 amount;
        address winner;
    }

    /// @notice Server-signed proof that `player` cleared `levelId` in `timeMs` for bounty `bountyId`.
    ///         EIP-712 type: `BountyClaim(uint256 bountyId,uint256 levelId,address player,uint32 timeMs,uint256 nonce,uint256 deadline)`
    struct BountyClaim {
        uint256 bountyId;
        uint256 levelId;
        address player;
        uint32 timeMs;
        uint256 nonce;
        uint256 deadline;
    }

    // =====================================================================================================
    //                                            CONSTANTS
    // =====================================================================================================

    /// @notice Role of the game-server signing key(s) (rotated with grantRole/revokeRole).
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    /// @notice EIP-712 typehash. Server (`signTypedData`) and web MUST use the exact same string.
    bytes32 public constant BOUNTY_CLAIM_TYPEHASH = keccak256(
        "BountyClaim(uint256 bountyId,uint256 levelId,address player,uint32 timeMs,uint256 nonce,uint256 deadline)"
    );
    /// @notice Longest allowed expiry window. Keeps refunds reachable in a reasonable time.
    uint256 public constant MAX_DURATION = 365 days;

    // =====================================================================================================
    //                                             STORAGE
    // =====================================================================================================

    /// @notice FORGE token (ForgeCoin).
    IERC20 public immutable forge;
    /// @notice LevelNFT (owner/creator lookups through the frozen ILevelNFT interface).
    ILevelNFT public immutable levelNFT;

    /// @notice Next bounty id (ids start at 1; 0 = none).
    uint256 public nextBountyId = 1;
    mapping(uint256 => Bounty) internal _bounties;
    /// @notice `contributions[bountyId][sponsor]` — FORGE escrowed by each sponsor (refund basis).
    mapping(uint256 => mapping(address => uint256)) public contributions;
    /// @notice `claimNonceUsed[player][nonce]` — unordered per-player nonces of BountyClaim (server picks them).
    mapping(address => mapping(uint256 => bool)) public claimNonceUsed;

    // =====================================================================================================
    //                                          EVENTS / ERRORS
    // =====================================================================================================

    event BountyCreated(
        uint256 indexed bountyId,
        uint256 indexed levelId,
        address indexed sponsor,
        uint256 amount,
        uint32 targetTimeMs,
        uint64 expiry
    );
    event BountyFunded(uint256 indexed bountyId, address indexed sponsor, uint256 amount, uint256 total);
    event BountyClaimed(
        uint256 indexed bountyId, uint256 indexed levelId, address indexed player, uint256 amount, uint32 timeMs
    );
    event BountyRefunded(uint256 indexed bountyId, address indexed sponsor, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidExpiry(uint64 expiry);
    error BountyNotFound(uint256 bountyId);
    error BountyNotOpen(uint256 bountyId);
    error BountyExpired(uint256 bountyId);
    error BountyNotExpired(uint256 bountyId);
    error NotClaimPlayer(address caller, address player);
    error LevelMismatch(uint256 expected, uint256 got);
    error TargetNotBeaten(uint32 targetTimeMs, uint32 timeMs);
    error IneligiblePlayer(address player);
    error SignatureExpired(uint256 deadline);
    error NonceAlreadyUsed(address player, uint256 nonce);
    error InvalidSigner(address recovered);
    error NothingToRefund(uint256 bountyId, address sponsor);

    // =====================================================================================================
    //                                           CONSTRUCTOR
    // =====================================================================================================

    /// @param forge_ ForgeCoin address.
    /// @param levelNFT_ LevelNFT address.
    /// @param signer Game-server signing key (gets SIGNER_ROLE). The deployer becomes DEFAULT_ADMIN.
    constructor(IERC20 forge_, ILevelNFT levelNFT_, address signer) EIP712("RealmForge LevelBounty", "1") {
        if (address(forge_) == address(0) || address(levelNFT_) == address(0) || signer == address(0)) {
            revert ZeroAddress();
        }
        forge = forge_;
        levelNFT = levelNFT_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SIGNER_ROLE, signer);
    }

    // =====================================================================================================
    //                                             SPONSORS
    // =====================================================================================================

    /// @notice Escrows `amount` FORGE as a new bounty on `levelId`. Needs a prior `approve(this, amount)`.
    /// @param levelId Level token id (must exist: `levelInfo` reverts otherwise).
    /// @param amount FORGE wei escrowed, > 0.
    /// @param targetTimeMs 0 = any clear; otherwise the clear must take at most this many ms.
    /// @param expiry 0 = no expiry (cannot be refunded); else a timestamp in (now, now + MAX_DURATION].
    /// @return bountyId Id of the new bounty.
    function createBounty(uint256 levelId, uint256 amount, uint32 targetTimeMs, uint64 expiry)
        external
        nonReentrant
        returns (uint256 bountyId)
    {
        if (amount == 0) revert ZeroAmount();
        if (expiry != 0 && (expiry <= block.timestamp || expiry > block.timestamp + MAX_DURATION)) {
            revert InvalidExpiry(expiry);
        }
        levelNFT.levelInfo(levelId); // reverts for an unknown level (view call)

        bountyId = nextBountyId++;
        _bounties[bountyId] = Bounty({
            levelId: levelId,
            sponsor: msg.sender,
            targetTimeMs: targetTimeMs,
            expiry: expiry,
            status: Status.Open,
            amount: amount,
            winner: address(0)
        });
        contributions[bountyId][msg.sender] = amount;
        emit BountyCreated(bountyId, levelId, msg.sender, amount, targetTimeMs, expiry);

        forge.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Adds `amount` FORGE to an open, unexpired bounty. Terms (target, expiry) cannot change.
    /// @param bountyId Bounty id.
    /// @param amount FORGE wei, > 0. Needs a prior `approve(this, amount)`.
    function topUp(uint256 bountyId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Bounty storage b = _openBounty(bountyId);
        if (_expired(b)) revert BountyExpired(bountyId);

        b.amount += amount;
        contributions[bountyId][msg.sender] += amount;
        emit BountyFunded(bountyId, msg.sender, amount, b.amount);

        forge.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice After expiry, an unclaimed bounty returns each sponsor's own contribution (pull pattern).
    /// @param bountyId Bounty id.
    function refund(uint256 bountyId) external nonReentrant {
        Bounty storage b = _openBounty(bountyId);
        if (!_expired(b)) revert BountyNotExpired(bountyId);
        uint256 amount = contributions[bountyId][msg.sender];
        if (amount == 0) revert NothingToRefund(bountyId, msg.sender);

        contributions[bountyId][msg.sender] = 0;
        b.amount -= amount;
        emit BountyRefunded(bountyId, msg.sender, amount);

        forge.safeTransfer(msg.sender, amount);
    }

    // =====================================================================================================
    //                                              PLAYERS
    // =====================================================================================================

    /// @notice Takes the whole pot of bounty `c.bountyId` with a server-signed BountyClaim.
    /// @dev Checks: caller is the player, deadline, nonce, signer has SIGNER_ROLE, bounty open + unexpired,
    ///      level matches, target time met, player is not the level owner/creator nor a sponsor of this bounty.
    ///      Effects (nonce, status, winner, amount = 0) happen before the transfer. "First" = first mined claim.
    /// @param c Signed claim.
    /// @param sig 65-byte ECDSA signature of `c` by a SIGNER_ROLE key.
    function claim(BountyClaim calldata c, bytes calldata sig) external nonReentrant {
        // ---------------------------------------------------------------- checks
        if (msg.sender != c.player) revert NotClaimPlayer(msg.sender, c.player);
        if (block.timestamp > c.deadline) revert SignatureExpired(c.deadline);
        if (claimNonceUsed[c.player][c.nonce]) revert NonceAlreadyUsed(c.player, c.nonce);
        _checkSigner(hashBountyClaim(c), sig);

        Bounty storage b = _openBounty(c.bountyId);
        if (_expired(b)) revert BountyExpired(c.bountyId);
        if (b.levelId != c.levelId) revert LevelMismatch(b.levelId, c.levelId);
        if (b.targetTimeMs != 0 && c.timeMs > b.targetTimeMs) revert TargetNotBeaten(b.targetTimeMs, c.timeMs);

        // The owner and the creator could otherwise drain any bounty put on their own level (they know its
        // layout best, and the owner could even be a sponsor's alt). A sponsor claiming its own bounty would be
        // a disguised refund that skips the expiry and takes the other sponsors' top-ups.
        (address owner, address creator,,) = levelNFT.levelInfo(c.levelId);
        if (c.player == owner || c.player == creator || contributions[c.bountyId][c.player] != 0) {
            revert IneligiblePlayer(c.player);
        }

        // ---------------------------------------------------------------- effects
        claimNonceUsed[c.player][c.nonce] = true;
        uint256 amount = b.amount;
        b.amount = 0;
        b.status = Status.Claimed;
        b.winner = c.player;
        emit BountyClaimed(c.bountyId, c.levelId, c.player, amount, c.timeMs);

        // ---------------------------------------------------------------- interaction
        forge.safeTransfer(c.player, amount);
    }

    // =====================================================================================================
    //                                               VIEWS
    // =====================================================================================================

    /// @notice Full bounty record.
    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        return _bounties[bountyId];
    }

    /// @notice True when the bounty exists, is unclaimed and has passed its expiry (sponsors may refund).
    function isExpired(uint256 bountyId) external view returns (bool) {
        Bounty storage b = _bounties[bountyId];
        return b.status == Status.Open && _expired(b);
    }

    /// @notice EIP-712 digest of a BountyClaim (what the server signs).
    function hashBountyClaim(BountyClaim calldata c) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(BOUNTY_CLAIM_TYPEHASH, c.bountyId, c.levelId, c.player, c.timeMs, c.nonce, c.deadline)
            )
        );
    }

    /// @notice EIP-712 domain separator (name "RealmForge LevelBounty", version "1").
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // =====================================================================================================
    //                                              INTERNAL
    // =====================================================================================================

    function _openBounty(uint256 bountyId) internal view returns (Bounty storage b) {
        b = _bounties[bountyId];
        if (b.status == Status.None) revert BountyNotFound(bountyId);
        if (b.status != Status.Open) revert BountyNotOpen(bountyId);
    }

    function _expired(Bounty storage b) internal view returns (bool) {
        return b.expiry != 0 && block.timestamp >= b.expiry;
    }

    /// @dev Reverts with {InvalidSigner} unless `sig` over `digest` was produced by a SIGNER_ROLE holder.
    function _checkSigner(bytes32 digest, bytes calldata sig) internal view {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || !hasRole(SIGNER_ROLE, recovered)) revert InvalidSigner(recovered);
    }
}
