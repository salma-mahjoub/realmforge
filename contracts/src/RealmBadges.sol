// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title RealmBadges — soulbound ERC-1155 achievement badges for RealmForge
/// @notice One token id per badge type. A badge is earned off-chain (the server reads indexed LevelNFT /
///         ForgeCoin events) and claimed on-chain by the player with a server-signed EIP-712 `BadgeClaim`.
///         Each `(holder, badgeId, ref)` can be minted once: `ref` names what the badge was earned on
///         (a level id for FIRST_CLEAR / RECORD_HOLDER / CREATOR, `uint256(roomId)` for RACE_WINNER), so the
///         balance of a badge type counts how many times it was earned.
/// @dev Soulbound: badges can only be minted. Every transfer, batch transfer, approval and burn reverts with
///      {Soulbound}. Metadata is fully on-chain: {uri} returns a base64 JSON data URI with an SVG image.
///      Trust model: same as ForgeCoin, the game-server signer decides eligibility (a known centralisation
///      point). The contract only enforces signer, deadline, chainId + verifying contract (EIP-712 domain),
///      a single-use nonce and the one-mint-per-(holder, badge, ref) rule.
///      EIP-712 domain: name "RealmForge Badges", version "1".
contract RealmBadges is ERC1155, AccessControl, EIP712 {
    using Strings for uint256;

    /// @notice A server-signed authorisation to mint one badge.
    struct BadgeClaim {
        address holder;
        uint256 badgeId;
        uint256 ref;
        uint256 nonce;
        uint256 deadline;
    }

    // ---------------------------------------------------------------- badge types (ERC-1155 token ids)
    /// @notice First player (other than the creator) to clear a level. ref = levelId.
    uint256 public constant FIRST_CLEAR = 1;
    /// @notice Set a level's best time (a `NewRecord` event). ref = levelId.
    uint256 public constant RECORD_HOLDER = 2;
    /// @notice Won (ranked 1st in) a settled staked race. ref = uint256(roomId).
    uint256 public constant RACE_WINNER = 3;
    /// @notice Published a level. ref = levelId.
    uint256 public constant CREATOR = 4;
    /// @notice Highest valid badge id.
    uint256 public constant BADGE_COUNT = 4;

    bytes32 public constant BADGE_CLAIM_TYPEHASH =
        keccak256("BadgeClaim(address holder,uint256 badgeId,uint256 ref,uint256 nonce,uint256 deadline)");

    // ---------------------------------------------------------------- storage
    /// @notice Server key that signs BadgeClaim messages.
    address public signer;
    /// @notice `nonceUsed[holder][nonce]` — unordered single-use nonces (server picks random ones).
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    /// @notice `claimed[holder][badgeId][ref]` — the one-per-(holder, badge, ref) rule.
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public claimed;

    // ---------------------------------------------------------------- events
    event BadgeClaimed(address indexed holder, uint256 indexed badgeId, uint256 indexed ref, uint256 nonce);
    event SignerUpdated(address indexed previous, address indexed current);

    // ---------------------------------------------------------------- errors
    error ZeroAddress();
    error Soulbound();
    error UnknownBadge(uint256 badgeId);
    error SignatureExpired(uint256 deadline);
    error NonceAlreadyUsed(address holder, uint256 nonce);
    error AlreadyClaimed(address holder, uint256 badgeId, uint256 ref);
    error InvalidSignature(address recovered);

    /// @param signer_ Game-server signing key (the same key that signs runs and races).
    constructor(address signer_) ERC1155("") EIP712("RealmForge Badges", "1") {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        emit SignerUpdated(address(0), signer_);
    }

    // ================================================================ admin

    /// @notice Rotates the server signing key.
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    // ================================================================ claim

    /// @notice Mints badge `c.badgeId` to `c.holder` if the server signed it.
    /// @dev Anyone may submit (a relayer can pay the gas): the badge always goes to `c.holder`, so front-running
    ///      only gifts the holder their own badge. Checks → effects (nonce, claimed) → `_mint`. `_mint` calls
    ///      `onERC1155Received` on contract holders; the state is already updated, so a re-entering holder hits
    ///      {NonceAlreadyUsed} / {AlreadyClaimed}.
    function claim(BadgeClaim calldata c, bytes calldata sig) external {
        if (c.holder == address(0)) revert ZeroAddress();
        if (c.badgeId == 0 || c.badgeId > BADGE_COUNT) revert UnknownBadge(c.badgeId);
        if (block.timestamp > c.deadline) revert SignatureExpired(c.deadline);
        if (nonceUsed[c.holder][c.nonce]) revert NonceAlreadyUsed(c.holder, c.nonce);
        if (claimed[c.holder][c.badgeId][c.ref]) revert AlreadyClaimed(c.holder, c.badgeId, c.ref);
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hashBadgeClaim(c), sig);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert InvalidSignature(recovered);

        nonceUsed[c.holder][c.nonce] = true;
        claimed[c.holder][c.badgeId][c.ref] = true;
        emit BadgeClaimed(c.holder, c.badgeId, c.ref, c.nonce);
        _mint(c.holder, c.badgeId, 1, "");
    }

    /// @notice EIP-712 digest of a BadgeClaim (what the server signs).
    function hashBadgeClaim(BadgeClaim calldata c) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(BADGE_CLAIM_TYPEHASH, c.holder, c.badgeId, c.ref, c.nonce, c.deadline))
        );
    }

    /// @notice ERC-5192-style lock flag: every badge is permanently locked to its holder.
    function locked(uint256 badgeId) external pure returns (bool) {
        if (badgeId == 0 || badgeId > BADGE_COUNT) revert UnknownBadge(badgeId);
        return true;
    }

    // ================================================================ soulbound overrides

    /// @dev Approvals are meaningless for a non-transferable token: always revert.
    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, uint256, bytes memory) public pure override {
        revert Soulbound();
    }

    function safeBatchTransferFrom(address, address, uint256[] memory, uint256[] memory, bytes memory)
        public
        pure
        override
    {
        revert Soulbound();
    }

    /// @dev Defence in depth: only mints (from == 0) may move balances, so no future internal path can
    ///      transfer or burn a badge.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }

    // ================================================================ metadata

    /// @notice Display name of a badge type.
    function badgeName(uint256 badgeId) public pure returns (string memory) {
        if (badgeId == FIRST_CLEAR) return "First Clear";
        if (badgeId == RECORD_HOLDER) return "Record Holder";
        if (badgeId == RACE_WINNER) return "Race Winner";
        if (badgeId == CREATOR) return "Creator";
        revert UnknownBadge(badgeId);
    }

    function _description(uint256 badgeId) internal pure returns (string memory) {
        if (badgeId == FIRST_CLEAR) return "First player to clear a RealmForge level.";
        if (badgeId == RECORD_HOLDER) return "Set the best time on a RealmForge level.";
        if (badgeId == RACE_WINNER) return "Won a staked FORGE versus race.";
        return "Published a level as a RealmForge LevelNFT.";
    }

    /// @dev (accent colour, short glyph label) per badge.
    function _style(uint256 badgeId) internal pure returns (string memory accent, string memory glyph) {
        if (badgeId == FIRST_CLEAR) return ("#ffc83d", "1st");
        if (badgeId == RECORD_HOLDER) return ("#7c5cff", "REC");
        if (badgeId == RACE_WINNER) return ("#3ddc97", "WIN");
        return ("#4cc9f0", "MAKER");
    }

    /// @notice Simple on-chain SVG art: a navy medal with an accent ring, a glyph and the badge name.
    function badgeSVG(uint256 badgeId) public pure returns (string memory) {
        string memory name = badgeName(badgeId); // reverts on unknown ids
        (string memory accent, string memory glyph) = _style(badgeId);
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">',
            '<rect width="200" height="200" rx="28" fill="#0f1424"/>',
            '<circle cx="100" cy="88" r="58" fill="none" stroke="', accent, '" stroke-width="10"/>',
            '<circle cx="100" cy="88" r="44" fill="', accent, '" fill-opacity="0.18"/>',
            '<text x="100" y="99" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="30" fill="',
            accent, '">', glyph, "</text>",
            '<text x="100" y="178" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="18" fill="#ffffff">',
            name, "</text></svg>"
        );
    }

    /// @notice ERC-1155 metadata URI: `data:application/json;base64,...` with an embedded SVG image.
    function uri(uint256 badgeId) public pure override returns (string memory) {
        string memory json = string.concat(
            '{"name":"RealmForge ', badgeName(badgeId),
            '","description":"', _description(badgeId),
            ' Soulbound: cannot be transferred.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(badgeSVG(badgeId))),
            '","attributes":[{"trait_type":"badge","value":"', badgeName(badgeId),
            '"},{"trait_type":"soulbound","value":"true"},{"trait_type":"id","value":"', badgeId.toString(), '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
