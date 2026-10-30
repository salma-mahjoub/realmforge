// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {ILevelNFT} from "./interfaces/ILevelNFT.sol";

/// @title LevelNFT — every published RealmForge level is an ERC-721 (SPEC §4)
/// @author Student A
/// @notice The owner of a level earns 70% of its FORGE play fees (paid through ForgeCoin), can sell it on the
///         built-in fixed-price market (ETH), and the original creator (+ remix parent) earns royalties.
/// @dev Bases: ERC721, ERC721URIStorage, ERC2981, AccessControl, ReentrancyGuard, EIP712 (OpenZeppelin v5).
///      EIP-712 domain: name "RealmForge LevelNFT", version "1", chainId, verifyingContract = this.
///      No ERC721Enumerable on purpose (gas): leaderboards/history come from events via the indexer.
contract LevelNFT is ERC721, ERC721URIStorage, ERC2981, AccessControl, ReentrancyGuard, EIP712, ILevelNFT {
    // =====================================================================================================
    //                                              TYPES
    // =====================================================================================================

    /// @notice On-chain record of a level (SPEC §4.1).
    struct Level {
        address creator; // original author (immutable)
        bytes32 layoutHash; // keccak256 of canonical level JSON
        uint256 parentId; // 0 = original, else remix source
        uint96 playFee; // in FORGE (ERC-20 units), set by owner
        uint32 plays;
        uint32 clears;
        uint32 likes;
        uint32 bestTimeMs;
        address bestPlayer;
        bool active;
    }

    // =====================================================================================================
    //                                            CONSTANTS
    // =====================================================================================================

    /// @notice Role allowed to call {recordRun}. Granted to the ForgeCoin contract at deploy time.
    bytes32 public constant GAME_ROLE = keccak256("GAME_ROLE");
    /// @notice Role of the game-server key that signs `ClearProof`s.
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    /// @notice Maximum play fee per run: 100 FORGE.
    uint96 public constant MAX_PLAY_FEE = 100e18;
    /// @notice Royalty on secondary sales: 5% (basis points, denominator 10_000).
    uint96 public constant REMIX_ROYALTY_BPS = 500;

    /// @notice EIP-712 typehash of the clear proof signed by the server once the creator beat their own level.
    bytes32 public constant CLEAR_PROOF_TYPEHASH =
        keccak256("ClearProof(address creator,bytes32 layoutHash,uint256 deadline)");

    // =====================================================================================================
    //                                             STORAGE
    // =====================================================================================================

    /// @notice Level data by token id.
    mapping(uint256 => Level) public levels;
    /// @notice True once a layout has been published (no duplicate publishing).
    mapping(bytes32 => bool) public hashUsed;
    /// @notice Fixed-price listing in wei. 0 = not listed.
    mapping(uint256 => uint256) public listingPrice;
    /// @notice `liked[id][user]` — one like per user per level.
    mapping(uint256 => mapping(address => bool)) public liked;
    /// @notice EIP-712 digests already consumed by {publish} (replay protection).
    mapping(bytes32 => bool) public usedProof;
    /// @notice ETH owed to sellers / creators (pull-payment pattern).
    mapping(address => uint256) public pendingWithdrawals;
    /// @notice Next token id to mint (ids start at 1 so that `parentId == 0` means "original").
    uint256 public nextId = 1;

    // =====================================================================================================
    //                                             EVENTS (SPEC §4.3)
    // =====================================================================================================

    event LevelPublished(
        uint256 indexed id, address indexed creator, bytes32 indexed layoutHash, uint256 parentId, uint96 playFee
    );
    event PlayFeeUpdated(uint256 indexed id, uint96 fee);
    event LevelToggled(uint256 indexed id, bool active);
    event Liked(uint256 indexed id, address indexed user);
    event Listed(uint256 indexed id, uint256 price);
    event Unlisted(uint256 indexed id);
    event Sold(uint256 indexed id, address indexed from, address indexed to, uint256 price);
    event RunRecorded(uint256 indexed id, address indexed player, uint32 timeMs, bool cleared);
    event NewRecord(uint256 indexed id, address indexed player, uint32 timeMs);
    /// @notice Extra (not in SPEC §4.3): emitted by {withdraw} for the indexer / UI.
    event Withdrawn(address indexed account, uint256 amount);

    // =====================================================================================================
    //                                             ERRORS
    // =====================================================================================================

    error ZeroAddress();
    error LayoutAlreadyUsed(bytes32 layoutHash);
    error PlayFeeTooHigh(uint96 fee, uint96 max);
    error ParentNotFound(uint256 parentId);
    error ProofExpired(uint256 deadline);
    error ProofAlreadyUsed(bytes32 digest);
    error InvalidSigner(address recovered);
    error NotTokenOwner(uint256 id, address caller);
    error AlreadyLiked(uint256 id, address user);
    error ZeroPrice();
    error NotListed(uint256 id);
    error WrongPayment(uint256 sent, uint256 expected);
    error CannotBuyOwnLevel(uint256 id);
    error NothingToWithdraw();
    error EthTransferFailed();

    // =====================================================================================================
    //                                           CONSTRUCTOR
    // =====================================================================================================

    /// @param signer Address of the game-server signing key (gets SIGNER_ROLE).
    /// @dev The deployer becomes DEFAULT_ADMIN and must later `grantRole(GAME_ROLE, forgeCoin)` (deploy step 4).
    constructor(address signer)
        ERC721("RealmForge Level", "RFLVL")
        EIP712("RealmForge LevelNFT", "1")
    {
        if (signer == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(SIGNER_ROLE, signer);
    }

    // =====================================================================================================
    //                                            MODIFIERS
    // =====================================================================================================

    /// @dev Reverts with {NotTokenOwner} unless `msg.sender` owns `id` (also reverts if `id` does not exist).
    modifier onlyTokenOwner(uint256 id) {
        if (ownerOf(id) != msg.sender) revert NotTokenOwner(id, msg.sender);
        _;
    }

    // =====================================================================================================
    //                                         PUBLISH / OWNER
    // =====================================================================================================

    /// @notice Mints a new level NFT to `msg.sender`.
    /// @dev Requires a server-signed EIP-712 `ClearProof{creator: msg.sender, layoutHash, deadline}` proving the
    ///      creator cleared the level in the editor. Checks: unique layout, fee <= MAX_PLAY_FEE, parent exists if
    ///      remix, deadline not passed, proof not used, signer has SIGNER_ROLE.
    /// @param layoutHash keccak256 of the canonical level JSON pinned on IPFS.
    /// @param uri Token URI (e.g. `ipfs://<cid>` of the metadata JSON).
    /// @param playFee Fee in FORGE wei that players pay per run.
    /// @param parentId 0 for an original level, or the id of the remixed level.
    /// @param deadline Unix timestamp after which `clearSig` is no longer valid.
    /// @param clearSig 65-byte ECDSA signature of the ClearProof by a SIGNER_ROLE key.
    /// @return id The newly minted token id.
    function publish(
        bytes32 layoutHash,
        string calldata uri,
        uint96 playFee,
        uint256 parentId,
        uint256 deadline,
        bytes calldata clearSig
    ) external returns (uint256 id) {
        // ---- checks
        if (hashUsed[layoutHash]) revert LayoutAlreadyUsed(layoutHash);
        if (playFee > MAX_PLAY_FEE) revert PlayFeeTooHigh(playFee, MAX_PLAY_FEE);
        if (parentId != 0 && _ownerOf(parentId) == address(0)) revert ParentNotFound(parentId);
        if (block.timestamp > deadline) revert ProofExpired(deadline);

        bytes32 digest = hashClearProof(msg.sender, layoutHash, deadline);
        if (usedProof[digest]) revert ProofAlreadyUsed(digest);
        _checkSigner(digest, clearSig);

        // ---- effects
        usedProof[digest] = true;
        hashUsed[layoutHash] = true;
        id = nextId++;
        levels[id] = Level({
            creator: msg.sender,
            layoutHash: layoutHash,
            parentId: parentId,
            playFee: playFee,
            plays: 0,
            clears: 0,
            likes: 0,
            bestTimeMs: 0,
            bestPlayer: address(0),
            active: true
        });

        // ERC-2981 for external marketplaces: the creator always receives the royalty.
        // TODO(studentA): ERC-2981 supports one receiver only. For remixes, consider a splitter
        //                 (e.g. OZ PaymentSplitter pattern) so external markets also pay the parent creator.
        _setTokenRoyalty(id, msg.sender, REMIX_ROYALTY_BPS);

        // `_mint` (not `_safeMint`): no external callback during publish → no reentrancy surface.
        // TODO(studentA): switch to `_safeMint` + `nonReentrant` if contract wallets must be supported safely.
        _mint(msg.sender, id);
        _setTokenURI(id, uri);

        emit LevelPublished(id, msg.sender, layoutHash, parentId, playFee);
    }

    /// @notice Updates the FORGE play fee of a level you own.
    /// @param id Level token id.
    /// @param fee New fee in FORGE wei, at most {MAX_PLAY_FEE}.
    function setPlayFee(uint256 id, uint96 fee) external onlyTokenOwner(id) {
        if (fee > MAX_PLAY_FEE) revert PlayFeeTooHigh(fee, MAX_PLAY_FEE);
        levels[id].playFee = fee;
        emit PlayFeeUpdated(id, fee);
    }

    /// @notice Takes a level offline (`false`) or brings it back (`true`). Inactive levels cannot be settled.
    /// @param id Level token id.
    /// @param active New status.
    function setActive(uint256 id, bool active) external onlyTokenOwner(id) {
        levels[id].active = active;
        emit LevelToggled(id, active);
    }

    /// @notice Likes a level (once per address per level).
    /// @param id Level token id.
    function like(uint256 id) external {
        _requireOwned(id);
        if (liked[id][msg.sender]) revert AlreadyLiked(id, msg.sender);
        liked[id][msg.sender] = true;
        unchecked {
            levels[id].likes++; // uint32: overflow is unrealistic and harmless
        }
        emit Liked(id, msg.sender);
    }

    // =====================================================================================================
    //                                          FIXED-PRICE MARKET
    // =====================================================================================================

    /// @notice Lists a level you own for `priceWei` ETH. Re-listing updates the price.
    /// @dev No approval is required: the listing itself authorises {buy}, and any transfer clears it (see {_update}).
    /// @param id Level token id.
    /// @param priceWei Price in wei (> 0).
    function list(uint256 id, uint256 priceWei) external onlyTokenOwner(id) {
        if (priceWei == 0) revert ZeroPrice();
        listingPrice[id] = priceWei;
        emit Listed(id, priceWei);
    }

    /// @notice Removes the listing of a level you own.
    /// @param id Level token id.
    function unlist(uint256 id) external onlyTokenOwner(id) {
        if (listingPrice[id] == 0) revert NotListed(id);
        delete listingPrice[id];
        emit Unlisted(id);
    }

    /// @notice Buys a listed level for exactly its listing price.
    /// @dev Pull pattern: royalties and proceeds are credited to {pendingWithdrawals}; no ETH is sent here.
    ///      Royalty = 5% of price → creator; for a remix it is split 50/50 between creator and parent creator.
    ///      Then the NFT is transferred; {_update} clears the listing.
    /// @param id Level token id.
    function buy(uint256 id) external payable nonReentrant {
        uint256 price = listingPrice[id];
        if (price == 0) revert NotListed(id);
        if (msg.value != price) revert WrongPayment(msg.value, price);
        address seller = ownerOf(id);
        if (seller == msg.sender) revert CannotBuyOwnLevel(id);

        Level storage lvl = levels[id];
        uint256 royalty = (price * REMIX_ROYALTY_BPS) / _feeDenominator();

        // TODO(studentA): the 50/50 remix split is a design choice — document or change it
        //                 (e.g. a separate PARENT_ROYALTY_BPS, or recursive royalties up the remix chain).
        if (lvl.parentId != 0) {
            address parentCreator = levels[lvl.parentId].creator;
            uint256 parentCut = royalty / 2;
            pendingWithdrawals[parentCreator] += parentCut;
            pendingWithdrawals[lvl.creator] += royalty - parentCut;
        } else {
            pendingWithdrawals[lvl.creator] += royalty;
        }
        pendingWithdrawals[seller] += price - royalty;

        _transfer(seller, msg.sender, id); // clears the listing via _update
        emit Sold(id, seller, msg.sender, price);
    }

    /// @notice Withdraws all ETH owed to `msg.sender` (sales + royalties).
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0; // effects before interaction
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit Withdrawn(msg.sender, amount);
    }

    // =====================================================================================================
    //                                         GAME (ForgeCoin only)
    // =====================================================================================================

    /// @inheritdoc ILevelNFT
    /// @dev plays++, clears++ if cleared, and best time/player update (emits {NewRecord}).
    function recordRun(uint256 id, address player, uint32 timeMs, bool cleared) external onlyRole(GAME_ROLE) {
        _requireOwned(id);
        Level storage lvl = levels[id];
        unchecked {
            lvl.plays++;
        }
        if (cleared) {
            unchecked {
                lvl.clears++;
            }
            if (lvl.bestTimeMs == 0 || timeMs < lvl.bestTimeMs) {
                lvl.bestTimeMs = timeMs;
                lvl.bestPlayer = player;
                emit NewRecord(id, player, timeMs);
            }
        }
        emit RunRecorded(id, player, timeMs, cleared);
    }

    // =====================================================================================================
    //                                              VIEWS
    // =====================================================================================================

    /// @inheritdoc ILevelNFT
    function levelInfo(uint256 id)
        external
        view
        returns (address owner, address creator, uint96 playFee, bool active)
    {
        owner = _requireOwned(id);
        Level storage lvl = levels[id];
        return (owner, lvl.creator, lvl.playFee, lvl.active);
    }

    /// @notice EIP-712 digest of a ClearProof (what the server signs). Useful for tests and off-chain checks.
    /// @param creator Address that will call {publish}.
    /// @param layoutHash Level layout hash.
    /// @param deadline Proof expiry timestamp.
    function hashClearProof(address creator, bytes32 layoutHash, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLEAR_PROOF_TYPEHASH, creator, layoutHash, deadline)));
    }

    /// @notice EIP-712 domain separator (name "RealmForge LevelNFT", version "1").
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // =====================================================================================================
    //                                         INTERNAL / OVERRIDES
    // =====================================================================================================

    /// @dev Reverts with {InvalidSigner} unless `sig` over `digest` was produced by a SIGNER_ROLE holder.
    function _checkSigner(bytes32 digest, bytes calldata sig) internal view {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || !hasRole(SIGNER_ROLE, recovered)) revert InvalidSigner(recovered);
    }

    /// @dev Any transfer (sale, transferFrom, safeTransferFrom) clears an active listing → no stale listings.
    function _update(address to, uint256 tokenId, address auth) internal override(ERC721) returns (address from) {
        from = super._update(to, tokenId, auth);
        if (from != address(0) && listingPrice[tokenId] != 0) {
            delete listingPrice[tokenId];
            emit Unlisted(tokenId);
        }
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    /// @inheritdoc ERC721
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721URIStorage, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
