// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {ILevelNFT} from "./interfaces/ILevelNFT.sol";
import {IForgeCoin} from "./interfaces/IForgeCoin.sol";

/// @title ForgeCoin (FORGE) — the RealmForge in-game currency (SPEC §5)
/// @author Student B
/// @notice Players pay level fees in FORGE, earn FORGE for clears and records, creators earn from plays,
///         races escrow stakes, and a season pool rewards the best players and creators.
/// @dev Bases: ERC20, ERC20Permit (gasless approve, ERC-2612), ERC20Capped, AccessControl, ReentrancyGuard,
///      EIP712, Pausable (OpenZeppelin v5). `EIP712` is inherited through `ERC20Permit`, which is why it is not
///      listed again: one domain serves both `Permit` and the game structs.
///      EIP-712 domain: name "RealmForge ForgeCoin", version "1", chainId, verifyingContract = this.
///      Fees and pool are held by this contract and tracked in `seasonPool` / `treasuryBalance`.
contract ForgeCoin is ERC20, ERC20Permit, ERC20Capped, AccessControl, ReentrancyGuard, Pausable, IForgeCoin {
    // =====================================================================================================
    //                                              TYPES
    // =====================================================================================================

    /// @notice Lifecycle of a race room.
    enum RaceStatus {
        None,
        Open,
        Settled,
        Refunded
    }

    /// @notice Escrowed versus race (SPEC §5.3).
    struct Race {
        uint256 levelId;
        uint256 stake; // per player, FORGE wei
        uint64 createdAt;
        RaceStatus status;
        address[] players; // players[0] = room creator
    }

    /// @notice ForgeCoin's own per-level stats (ILevelNFT only exposes owner/creator/fee/active).
    struct LevelStats {
        uint32 plays;
        uint32 clears;
        uint32 bestTimeMs;
    }

    // =====================================================================================================
    //                                            CONSTANTS (SPEC §5.1)
    // =====================================================================================================

    /// @notice Hard cap: 100,000,000 FORGE.
    uint256 public constant MAX_SUPPLY = 100_000_000e18;
    /// @notice One-time faucet amount per address.
    uint256 public constant FAUCET_AMOUNT = 100e18;
    /// @notice Max FORGE the faucet may mint per UTC day across all addresses (100 claims): Sybil damage control.
    uint256 public constant FAUCET_DAILY_BUDGET = 10_000e18;

    /// @notice Play fee split in basis points: 70% owner · 20% season pool · 10% treasury (remainder).
    uint256 public constant OWNER_BPS = 7_000;
    uint256 public constant POOL_BPS = 2_000;
    uint256 public constant BPS = 10_000;
    /// @notice Share of the treasury cut that is burned instead of kept (50% of 10% = 5% of every play fee).
    uint256 public constant TREASURY_BURN_BPS = 5_000;

    /// @notice Clear reward = BASE_REWARD + difficultyBonus, the sum capped at MAX_CLEAR_REWARD.
    uint256 public constant BASE_REWARD = 5e18;
    uint256 public constant MAX_CLEAR_REWARD = 50e18;
    /// @notice Bonus for the first clear ever of a level.
    uint256 public constant FIRST_CLEAR_BONUS = 20e18;
    /// @notice Bonus for beating the level's best time.
    uint256 public constant RECORD_BONUS = 10e18;
    /// @notice Bonus per in-game coin collected during a cleared run, and the cap of that bonus per run.
    uint256 public constant COIN_BONUS = 0.1e18;
    uint256 public constant MAX_COIN_BONUS = 5e18;
    /// @notice Max FORGE minted as rewards per player per UTC day (anti-farming).
    uint256 public constant DAILY_MINT_CAP = 200e18;

    /// @notice Season length.
    uint256 public constant SEASON_DURATION = 30 days;
    /// @notice Max winners per category when closing a season.
    uint256 public constant MAX_SEASON_WINNERS = 10;

    /// @notice Race payout split: 1st 60% · 2nd 25% · level owner 10% · season pool 5% (remainder).
    uint256 public constant RACE_FIRST_BPS = 6_000;
    uint256 public constant RACE_SECOND_BPS = 2_500;
    uint256 public constant RACE_OWNER_BPS = 1_000;
    uint256 public constant MAX_RACE_PLAYERS = 4;
    /// @notice After this delay an unsettled race can be refunded by anyone.
    uint256 public constant RACE_TIMEOUT = 1 hours;

    /// @notice EIP-712 typehashes. Server (`signTypedData`) and web MUST use the exact same strings.
    bytes32 public constant RUN_RESULT_TYPEHASH = keccak256(
        "RunResult(address player,uint256 levelId,uint32 timeMs,bool cleared,uint16 coins,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant RACE_RESULT_TYPEHASH = keccak256("RaceResult(bytes32 roomId,address[] ranking,uint256 deadline)");
    bytes32 public constant SEASON_RESULT_TYPEHASH = keccak256(
        "SeasonResult(uint256 season,address[] players,address[] creators,uint256[] shares)"
    );

    // =====================================================================================================
    //                                             STORAGE
    // =====================================================================================================

    /// @notice LevelNFT contract (set once by admin after deployment, deploy step 3).
    ILevelNFT public levelNFT;
    /// @notice Game-server key that signs RunResult / RaceResult / SeasonResult.
    address public signer;

    /// @notice Faucet already claimed by this address.
    mapping(address => bool) public faucetClaimed;
    /// @notice `faucetMintedOnDay[day]` — total minted by the faucet on a UTC day (`block.timestamp / 1 days`).
    mapping(uint256 => uint256) public faucetMintedOnDay;
    /// @notice `runNonceUsed[player][nonce]` — unordered per-player nonces for RunResult (server picks them).
    /// @dev Named differently from ERC-2612 `nonces(owner)` on purpose.
    mapping(address => mapping(uint256 => bool)) public runNonceUsed;
    /// @notice `mintedOnDay[player][day]` — rewards minted per UTC day (`block.timestamp / 1 days`).
    mapping(address => mapping(uint256 => uint256)) public mintedOnDay;
    /// @notice Per-level stats used for the difficulty bonus / first clear / record bonus.
    mapping(uint256 => LevelStats) public levelStats;

    /// @notice Race rooms by id (the id is chosen off-chain by the Colyseus room).
    mapping(bytes32 => Race) internal _races;

    /// @notice Current season number (starts at 1).
    uint256 public season = 1;
    /// @notice Timestamp after which the current season can be closed.
    uint256 public seasonEnd;
    /// @notice FORGE held by this contract for the season prize pool.
    uint256 public seasonPool;
    /// @notice FORGE held by this contract for the treasury.
    uint256 public treasuryBalance;

    // =====================================================================================================
    //                                             ERRORS
    // =====================================================================================================

    error ZeroAddress();
    error LevelNFTAlreadySet();
    error LevelNFTNotSet();
    error FaucetAlreadyClaimed(address user);
    error FaucetBudgetExhausted(uint256 day);
    error NotRunPlayer(address caller, address player);
    error SignatureExpired(uint256 deadline);
    error NonceAlreadyUsed(address player, uint256 nonce);
    error InvalidSignature(address recovered);
    error LevelInactive(uint256 levelId);
    error RaceExists(bytes32 roomId);
    error RaceNotOpen(bytes32 roomId);
    error RaceFull(bytes32 roomId);
    error RaceTimedOut(bytes32 roomId);
    error RaceNotTimedOut(bytes32 roomId);
    error AlreadyInRace(bytes32 roomId, address player);
    error InvalidRanking();
    error ZeroStake();
    error SeasonNotOver(uint256 seasonEnd);
    error InvalidSeasonInput();
    error NothingToWithdraw();
    error InvalidPlayerSignature(address player);
    error InvalidPermitAllowance(address player, uint256 expected, uint256 actual);

    /// @notice A run was settled by a third party (gasless relayer) with the player's signed authorisation.
    /// @dev Emitted after {RunSettled} by {settleRunFor}; `relayer` is `msg.sender` (who paid the gas).
    event RunRelayed(address indexed player, address indexed relayer, uint256 nonce);

    // =====================================================================================================
    //                                           CONSTRUCTOR
    // =====================================================================================================

    /// @param signer_ Address of the game-server signing key.
    /// @dev Deployer becomes DEFAULT_ADMIN. Season 1 ends 30 days after deployment.
    constructor(address signer_)
        ERC20("ForgeCoin", "FORGE")
        ERC20Permit("RealmForge ForgeCoin")
        ERC20Capped(MAX_SUPPLY)
    {
        if (signer_ == address(0)) revert ZeroAddress();
        signer = signer_;
        seasonEnd = block.timestamp + SEASON_DURATION;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        emit SignerUpdated(address(0), signer_);
    }

    // =====================================================================================================
    //                                              ADMIN
    // =====================================================================================================

    /// @notice Links the LevelNFT contract (deploy step 3). Can only be done once.
    /// @param levelNFT_ LevelNFT address. ForgeCoin must also receive GAME_ROLE on it (deploy step 4).
    function setLevelNFT(ILevelNFT levelNFT_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (address(levelNFT_) == address(0)) revert ZeroAddress();
        if (address(levelNFT) != address(0)) revert LevelNFTAlreadySet();
        levelNFT = levelNFT_;
        emit LevelNFTSet(address(levelNFT_));
    }

    /// @notice Rotates the server signing key (mitigation if the key leaks).
    /// @param newSigner New signer address.
    function setSigner(address newSigner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (newSigner == address(0)) revert ZeroAddress();
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    /// @notice Emergency circuit breaker: stops faucet, runs, race creation/join/settlement.
    /// @dev Refunds and ERC-20 transfers stay available so funds can never be locked by a pause.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    /// @notice Lifts the circuit breaker.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Sends the whole treasury balance to `to`.
    /// @param to Recipient.
    function withdrawTreasury(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = treasuryBalance;
        if (amount == 0) revert NothingToWithdraw();
        treasuryBalance = 0;
        _transfer(address(this), to, amount);
        emit TreasuryWithdrawn(to, amount);
    }

    // =====================================================================================================
    //                                              FAUCET
    // =====================================================================================================

    /// @inheritdoc IForgeCoin
    /// @dev Mints {FAUCET_AMOUNT} once per address. ERC20Capped reverts if the cap would be exceeded.
    ///      One claim per address cannot stop a Sybil attack (anyone can create fresh wallets), so the faucet
    ///      also has a global daily budget ({FAUCET_DAILY_BUDGET}): the damage of an attack is bounded per day.
    ///      Real identity checks (captcha, server-signed claim) would need an off-chain service and a new
    ///      EIP-712 type; they are left out because FORGE has no market value on a testnet.
    function claimFaucet() external whenNotPaused {
        if (faucetClaimed[msg.sender]) revert FaucetAlreadyClaimed(msg.sender);
        uint256 day = block.timestamp / 1 days;
        uint256 minted = faucetMintedOnDay[day] + FAUCET_AMOUNT;
        if (minted > FAUCET_DAILY_BUDGET) revert FaucetBudgetExhausted(day);
        faucetClaimed[msg.sender] = true;
        faucetMintedOnDay[day] = minted;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender);
    }

    // =====================================================================================================
    //                                            RUN SETTLEMENT
    // =====================================================================================================

    /// @inheritdoc IForgeCoin
    /// @dev Player must have approved `playFee` to this contract (or use {settleRunWithPermit}).
    ///      Order: checks (sender, deadline, nonce, signature, level active) → effects (nonce, fee split,
    ///      reward mint, stats) → interaction (`levelNFT.recordRun`). `nonReentrant` + `whenNotPaused`.
    function settleRun(RunResult calldata r, bytes calldata sig) external nonReentrant whenNotPaused {
        _settleRun(r, sig);
    }

    /// @inheritdoc IForgeCoin
    /// @dev SPEC lists `uint256 v`; the ERC-2612 standard (and viem `parseSignature`) use `uint8 v`, so uint8 is used.
    ///      The permit is wrapped in try/catch: if it was front-run, the allowance already exists and the run
    ///      still settles (OpenZeppelin's recommended pattern against permit griefing).
    /// @param v,rr,s ERC-2612 signature of `Permit(player, this, playFee, nonces(player), permitDeadline)`.
    function settleRunWithPermit(
        RunResult calldata r,
        bytes calldata sig,
        uint8 v,
        bytes32 rr,
        bytes32 s,
        uint256 permitDeadline
    ) external nonReentrant whenNotPaused {
        (,, uint96 playFee,) = _levelNFT().levelInfo(r.levelId);
        try this.permit(r.player, address(this), playFee, permitDeadline, v, rr, s) {} catch {}
        _settleRun(r, sig);
    }

    /// @notice Gasless settlement: anyone (in practice the RealmForge relayer, which pays the gas) submits a
    ///         run on behalf of `r.player`, who authorised it off-chain.
    /// @dev Two player signatures, zero player transactions:
    ///      - `playerSig`: the player's EIP-712 signature over the very same `RunResult` the server signed
    ///        (same typehash and domain, so no new type string). It replaces the `msg.sender == r.player`
    ///        check of {settleRun}: without it, whoever got hold of a server-signed result (e.g. the relayer)
    ///        could settle it at a moment the player did not choose. Verified with OpenZeppelin
    ///        `SignatureChecker`, so smart-contract wallets (ERC-1271) work too.
    ///      - `v, rr, s, permitDeadline`: the ERC-2612 permit for the play fee, exactly as in
    ///        {settleRunWithPermit} (try/catch, so a front-run permit does not block the run).
    ///      Replay: the run nonce is still burned by the shared body, so a relayed result can never be
    ///      settled twice by any path. Front-running: a copy of the relayer's transaction settles the same
    ///      run for the same player (nothing to steal: fee and reward only move from/to `r.player`), and the
    ///      relayer's own transaction then reverts with {NonceAlreadyUsed}. The relayer simulates first.
    ///      Rewards always go to `r.player`, never to `msg.sender`.
    function settleRunFor(
        RunResult calldata r,
        bytes calldata sig,
        bytes calldata playerSig,
        uint8 v,
        bytes32 rr,
        bytes32 s,
        uint256 permitDeadline
    ) external nonReentrant whenNotPaused {
        if (!SignatureChecker.isValidSignatureNow(r.player, hashRunResult(r), playerSig)) {
            revert InvalidPlayerSignature(r.player);
        }
        if (block.timestamp > r.deadline) revert SignatureExpired(r.deadline);
        if (runNonceUsed[r.player][r.nonce]) revert NonceAlreadyUsed(r.player, r.nonce);
        (,, uint96 playFee,) = _levelNFT().levelInfo(r.levelId);
        if (playFee > 0) {
            try this.permit(r.player, address(this), playFee, permitDeadline, v, rr, s) {} catch {}
            uint256 currentAllowance = allowance(r.player, address(this));
            // Permit front-running leaves precisely this allowance. Requiring equality prevents a stale
            // unlimited approval from silently substituting for the player's fee-specific authorisation.
            if (currentAllowance != playFee) revert InvalidPermitAllowance(r.player, playFee, currentAllowance);
        }
        _settle(r, sig);
        emit RunRelayed(r.player, msg.sender, r.nonce);
    }

    /// @dev Shared body of {settleRun} / {settleRunWithPermit}: the caller must be the player.
    function _settleRun(RunResult calldata r, bytes calldata sig) internal {
        if (msg.sender != r.player) revert NotRunPlayer(msg.sender, r.player);
        _settle(r, sig);
    }

    /// @dev Settlement body shared by every entry point. The caller has already authenticated the player
    ///      (`msg.sender` for {_settleRun}, a player signature for {settleRunFor}).
    function _settle(RunResult calldata r, bytes calldata sig) internal {
        // ---------------------------------------------------------------- checks
        if (block.timestamp > r.deadline) revert SignatureExpired(r.deadline);
        if (runNonceUsed[r.player][r.nonce]) revert NonceAlreadyUsed(r.player, r.nonce);
        _checkSignature(hashRunResult(r), sig);

        ILevelNFT nft = _levelNFT();
        (address owner, address creator, uint96 playFee, bool active) = nft.levelInfo(r.levelId); // view call
        if (!active) revert LevelInactive(r.levelId);
        // The current owner and the original creator are paid the level fee, so letting them also earn mint
        // rewards on it would be a self-farming loop. They may still play (and pay), but earn nothing.
        bool selfPlay = r.player == owner || r.player == creator;

        // ---------------------------------------------------------------- effects
        runNonceUsed[r.player][r.nonce] = true;

        if (playFee > 0) {
            _spendAllowance(r.player, address(this), playFee);
            (uint256 ownerAmt, uint256 poolAmt, uint256 treasuryAmt) = splitFee(playFee);
            // Half of the treasury cut is burned (deflationary sink); the rest stays in the contract.
            uint256 burnAmt = (treasuryAmt * TREASURY_BURN_BPS) / BPS;
            uint256 keptAmt = treasuryAmt - burnAmt;
            _transfer(r.player, owner, ownerAmt);
            _transfer(r.player, address(this), poolAmt + keptAmt);
            if (burnAmt > 0) _burn(r.player, burnAmt);
            seasonPool += poolAmt;
            treasuryBalance += keptAmt;
            emit FeeSplit(r.levelId, owner, ownerAmt, poolAmt, keptAmt);
            if (burnAmt > 0) emit FeeBurned(r.levelId, burnAmt);
        }

        uint256 reward;
        if (!selfPlay) {
            reward = _mintReward(r.player, _computeReward(r));
            // Self-plays also stay out of the reward statistics, otherwise an owner could consume the
            // first-clear bonus or set an unbeatable record time on their own level.
            _updateStats(r);
        }

        // ---------------------------------------------------------------- interaction
        nft.recordRun(r.levelId, r.player, r.timeMs, r.cleared);

        emit RunSettled(r.player, r.levelId, r.timeMs, r.cleared, reward, playFee);
    }

    /// @notice Gross reward (before daily/supply caps) a run would earn given current level stats.
    /// @dev reward = min(BASE + 45 * (1 - clears/plays), 50) + first-clear bonus + record bonus
    ///      + min(coins * COIN_BONUS, MAX_COIN_BONUS). 0 if not cleared.
    ///      The coin bonus is capped on-chain on purpose: the server already checks `coins <= coins in the level`,
    ///      but a creator could fill a level with coins, and a leaked signer key could sign any uint16.
    function _computeReward(RunResult calldata r) internal view returns (uint256 reward) {
        if (!r.cleared) return 0;
        LevelStats memory st = levelStats[r.levelId];
        reward = BASE_REWARD;
        if (st.plays > 0) {
            // difficulty = 1 - clears/plays, scaled to (MAX_CLEAR_REWARD - BASE_REWARD)
            reward += ((MAX_CLEAR_REWARD - BASE_REWARD) * (st.plays - st.clears)) / st.plays;
        }
        if (reward > MAX_CLEAR_REWARD) reward = MAX_CLEAR_REWARD;
        if (st.clears == 0) reward += FIRST_CLEAR_BONUS;
        if (st.bestTimeMs == 0 || r.timeMs < st.bestTimeMs) reward += RECORD_BONUS;
        uint256 coinBonus = uint256(r.coins) * COIN_BONUS;
        reward += coinBonus > MAX_COIN_BONUS ? MAX_COIN_BONUS : coinBonus;
    }

    /// @dev Mints `amount` clipped to the player's remaining daily cap and the remaining token cap.
    /// @return minted The amount actually minted.
    function _mintReward(address player, uint256 amount) internal returns (uint256 minted) {
        if (amount == 0) return 0;
        uint256 day = block.timestamp / 1 days;
        uint256 already = mintedOnDay[player][day];
        uint256 dailyLeft = already >= DAILY_MINT_CAP ? 0 : DAILY_MINT_CAP - already;
        uint256 supplyLeft = cap() - totalSupply();
        minted = amount;
        if (minted > dailyLeft) minted = dailyLeft;
        if (minted > supplyLeft) minted = supplyLeft;
        if (minted == 0) return 0;
        mintedOnDay[player][day] = already + minted;
        _mint(player, minted);
    }

    /// @dev Mirrors LevelNFT stats locally (plays/clears/best time) for reward computation.
    function _updateStats(RunResult calldata r) internal {
        LevelStats storage st = levelStats[r.levelId];
        unchecked {
            st.plays++;
        }
        if (r.cleared) {
            unchecked {
                st.clears++;
            }
            if (st.bestTimeMs == 0 || r.timeMs < st.bestTimeMs) st.bestTimeMs = r.timeMs;
        }
    }

    // =====================================================================================================
    //                                              RACES
    // =====================================================================================================

    /// @inheritdoc IForgeCoin
    /// @dev The creator joins automatically and escrows `stake`. Escrow uses `_transfer` from `msg.sender`
    ///      (explicit call by the payer, so no allowance is needed).
    function createRaceRoom(bytes32 roomId, uint256 levelId, uint256 stake) external nonReentrant whenNotPaused {
        if (stake == 0) revert ZeroStake();
        Race storage race = _races[roomId];
        if (race.status != RaceStatus.None) revert RaceExists(roomId);
        (,,, bool active) = _levelNFT().levelInfo(levelId);
        if (!active) revert LevelInactive(levelId);

        race.levelId = levelId;
        race.stake = stake;
        race.createdAt = uint64(block.timestamp);
        race.status = RaceStatus.Open;
        race.players.push(msg.sender);
        _transfer(msg.sender, address(this), stake);

        emit RaceCreated(roomId, levelId, msg.sender, stake);
        emit RaceJoined(roomId, msg.sender);
    }

    /// @inheritdoc IForgeCoin
    function joinRace(bytes32 roomId) external nonReentrant whenNotPaused {
        Race storage race = _races[roomId];
        if (race.status != RaceStatus.Open) revert RaceNotOpen(roomId);
        if (block.timestamp > race.createdAt + RACE_TIMEOUT) revert RaceTimedOut(roomId);
        uint256 n = race.players.length;
        if (n >= MAX_RACE_PLAYERS) revert RaceFull(roomId);
        for (uint256 i; i < n; ++i) {
            if (race.players[i] == msg.sender) revert AlreadyInRace(roomId, msg.sender);
        }
        race.players.push(msg.sender);
        _transfer(msg.sender, address(this), race.stake);
        emit RaceJoined(roomId, msg.sender);
    }

    /// @inheritdoc IForgeCoin
    /// @dev Anyone may submit; the server signature over `RaceResult{roomId, ranking}` is what authorises it.
    ///      Only ranking[0] and ranking[1] are paid; both must be distinct room players. Pot = stake * players.
    ///      1st 60% · 2nd 25% · level owner 10% · season pool gets the remainder (5% + rounding dust),
    ///      so the sum of payouts always equals the sum of stakes.
    ///      The signed result carries a `deadline`: a stale result (e.g. leaked or signed by mistake) stops being
    ///      valid, after which the room can only be refunded. Replay is impossible anyway: a room settles once.
    function settleRace(bytes32 roomId, address[] calldata ranking, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        whenNotPaused
    {
        Race storage race = _races[roomId];
        if (race.status != RaceStatus.Open) revert RaceNotOpen(roomId);
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        if (race.players.length < 2 || ranking.length < 2 || ranking.length > race.players.length) {
            revert InvalidRanking();
        }
        if (ranking[0] == ranking[1] || !_inRace(race, ranking[0]) || !_inRace(race, ranking[1])) {
            revert InvalidRanking();
        }
        _checkSignature(hashRaceResult(roomId, ranking, deadline), sig);

        race.status = RaceStatus.Settled;
        uint256 pot = race.stake * race.players.length;
        uint256 first = (pot * RACE_FIRST_BPS) / BPS;
        uint256 second = (pot * RACE_SECOND_BPS) / BPS;
        uint256 ownerAmt = (pot * RACE_OWNER_BPS) / BPS;
        uint256 poolAmt = pot - first - second - ownerAmt;
        (address owner,,,) = _levelNFT().levelInfo(race.levelId);

        seasonPool += poolAmt;
        _transfer(address(this), ranking[0], first);
        _transfer(address(this), ranking[1], second);
        _transfer(address(this), owner, ownerAmt);

        emit RaceSettled(roomId, ranking[0], ranking[1], pot);
    }

    /// @inheritdoc IForgeCoin
    /// @dev Refund path: after {RACE_TIMEOUT} an unsettled room returns every stake. Works even while paused.
    function refundRace(bytes32 roomId) external nonReentrant {
        Race storage race = _races[roomId];
        if (race.status != RaceStatus.Open) revert RaceNotOpen(roomId);
        if (block.timestamp <= race.createdAt + RACE_TIMEOUT) revert RaceNotTimedOut(roomId);
        race.status = RaceStatus.Refunded;
        uint256 n = race.players.length;
        for (uint256 i; i < n; ++i) {
            _transfer(address(this), race.players[i], race.stake);
        }
        emit RaceRefunded(roomId, n, race.stake);
    }

    /// @notice Returns a race room.
    function getRace(bytes32 roomId) external view returns (Race memory) {
        return _races[roomId];
    }

    function _inRace(Race storage race, address who) internal view returns (bool) {
        uint256 n = race.players.length;
        for (uint256 i; i < n; ++i) {
            if (race.players[i] == who) return true;
        }
        return false;
    }

    // =====================================================================================================
    //                                              SEASONS
    // =====================================================================================================

    /// @inheritdoc IForgeCoin
    /// @dev Two-key: DEFAULT_ADMIN submits, the server signs `SeasonResult{season, players, creators, shares}`.
    ///      `shares` are basis points, one per winner (`players` first, then `creators`), and must sum to 10_000.
    ///      Rounding dust stays in the pool for the next season.
    ///      The ranking criteria (distinct levels cleared, records held, distinct players on a creator's levels,
    ///      self-plays ignored) are computed off-chain by the indexer: see docs/SEASONS.md.
    function closeSeason(
        address[] calldata players,
        address[] calldata creators,
        uint256[] calldata shares,
        bytes calldata sig
    ) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        if (block.timestamp < seasonEnd) revert SeasonNotOver(seasonEnd);
        uint256 np = players.length;
        uint256 nc = creators.length;
        if (np > MAX_SEASON_WINNERS || nc > MAX_SEASON_WINNERS || shares.length != np + nc) {
            revert InvalidSeasonInput();
        }
        uint256 total;
        for (uint256 i; i < shares.length; ++i) {
            total += shares[i];
        }
        if (shares.length != 0 && total != BPS) revert InvalidSeasonInput();
        _checkSignature(hashSeasonResult(season, players, creators, shares), sig);

        uint256 pool = seasonPool;
        uint256 paid;
        for (uint256 i; i < np + nc; ++i) {
            address to = i < np ? players[i] : creators[i - np];
            if (to == address(0)) revert ZeroAddress();
            uint256 amt = (pool * shares[i]) / BPS;
            paid += amt;
            _transfer(address(this), to, amt);
        }
        seasonPool = pool - paid;

        emit SeasonClosed(season, pool);
        season += 1;
        seasonEnd = block.timestamp + SEASON_DURATION;
    }

    // =====================================================================================================
    //                                               VIEWS
    // =====================================================================================================

    /// @notice Pure fee split helper (70/20/10). `ownerAmt + poolAmt + treasuryAmt == fee` always holds.
    /// @dev `treasuryAmt` is the whole 10% cut: {settleRun} then burns {TREASURY_BURN_BPS} of it.
    /// @param fee Play fee in FORGE wei.
    function splitFee(uint256 fee) public pure returns (uint256 ownerAmt, uint256 poolAmt, uint256 treasuryAmt) {
        ownerAmt = (fee * OWNER_BPS) / BPS;
        poolAmt = (fee * POOL_BPS) / BPS;
        treasuryAmt = fee - ownerAmt - poolAmt; // remainder absorbs rounding
    }

    /// @notice EIP-712 digest of a RunResult (what the server signs).
    function hashRunResult(RunResult calldata r) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RUN_RESULT_TYPEHASH, r.player, r.levelId, r.timeMs, r.cleared, r.coins, r.nonce, r.deadline
                )
            )
        );
    }

    /// @notice EIP-712 digest of a RaceResult. Arrays are hashed as keccak256 of the 32-byte-padded elements.
    function hashRaceResult(bytes32 roomId, address[] calldata ranking, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(RACE_RESULT_TYPEHASH, roomId, keccak256(abi.encodePacked(ranking)), deadline))
        );
    }

    /// @notice EIP-712 digest of a SeasonResult.
    function hashSeasonResult(
        uint256 season_,
        address[] calldata players,
        address[] calldata creators,
        uint256[] calldata shares
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SEASON_RESULT_TYPEHASH,
                    season_,
                    keccak256(abi.encodePacked(players)),
                    keccak256(abi.encodePacked(creators)),
                    keccak256(abi.encodePacked(shares))
                )
            )
        );
    }

    // =====================================================================================================
    //                                         INTERNAL / OVERRIDES
    // =====================================================================================================

    function _levelNFT() internal view returns (ILevelNFT nft) {
        nft = levelNFT;
        if (address(nft) == address(0)) revert LevelNFTNotSet();
    }

    /// @dev Reverts with {InvalidSignature} unless `sig` over `digest` was produced by {signer}.
    function _checkSignature(bytes32 digest, bytes calldata sig) internal view {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || recovered != signer) revert InvalidSignature(recovered);
    }

    /// @dev ERC20Capped enforces `totalSupply() <= cap()` on every mint.
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
