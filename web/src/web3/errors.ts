/**
 * Turns wallet / viem / contract errors into one readable sentence for toasts and inline errors.
 * Never show a raw stack or a 2 KB RPC payload to a player.
 */

/** Custom errors of LevelNFT / ForgeCoin (and OZ v5 bases) → plain language. */
const CUSTOM_ERRORS: Record<string, string> = {
    // OpenZeppelin v5
    ERC20InsufficientBalance: 'Not enough FORGE in your wallet.',
    ERC20InsufficientAllowance: 'The FORGE allowance is too low — approve the fee first.',
    ERC20InvalidReceiver: 'Invalid receiver address.',
    ERC2612ExpiredSignature: 'The permit signature expired — try again.',
    ERC2612InvalidSigner: 'The permit was signed by a different account.',
    ERC721NonexistentToken: 'This level NFT does not exist on this network.',
    ERC721IncorrectOwner: 'You are not the owner of this level.',
    ERC721InsufficientApproval: 'The marketplace is not approved for this level.',
    ERC20ExceededCap: 'The FORGE supply cap has been reached.',
    EnforcedPause: 'ForgeCoin is paused by the admin right now.',
    AccessControlUnauthorizedAccount: 'Your account does not have the role for this action.',
    ReentrancyGuardReentrantCall: 'Re-entrant call blocked.',
    ECDSAInvalidSignature: 'The server signature is invalid.',
    // RealmForge custom errors (contracts/src/LevelNFT.sol, ForgeCoin.sol)
    AlreadyInRace: 'You already joined this race.',
    AlreadyLiked: 'You already liked this level.',
    CannotBuyOwnLevel: 'You already own this level.',
    EthTransferFailed: 'The ETH transfer failed.',
    FaucetAlreadyClaimed: 'You already claimed the faucet with this address.',
    FaucetBudgetExhausted: "Today's faucet budget is used up — try again tomorrow (UTC).",
    InvalidRanking: 'The race ranking is invalid.',
    InvalidSeasonInput: 'The season ranking is invalid (shares must total 100%).',
    InvalidSignature: 'The game server signature was rejected.',
    InvalidSigner: 'The result was not signed by the RealmForge server.',
    LayoutAlreadyUsed: 'This exact layout is already published.',
    LevelInactive: 'This level is inactive.',
    LevelNFTAlreadySet: 'ForgeCoin is already linked to a LevelNFT contract.',
    LevelNFTNotSet: 'ForgeCoin is not linked to LevelNFT yet (deployment step missing).',
    NonceAlreadyUsed: 'This run was already settled.',
    NothingToWithdraw: 'Nothing to withdraw yet.',
    NotListed: 'This level is not listed for sale.',
    NotRunPlayer: 'Only the player who made the run can settle it.',
    NotTokenOwner: 'Only the level owner can do this.',
    ParentNotFound: 'The remixed level does not exist.',
    PlayFeeTooHigh: 'The play fee is above the 100 FORGE maximum.',
    ProofAlreadyUsed: 'This clear proof was already used.',
    ProofExpired: 'The clear proof expired — request a new one.',
    RaceExists: 'A race with this room id already exists.',
    RaceFull: 'This race is full.',
    RaceNotOpen: 'This race is not open.',
    RaceNotTimedOut: 'Too early to refund: a race can be refunded one hour after it was created.',
    RaceTimedOut: 'This race timed out.',
    SeasonNotOver: 'The current season is not over yet.',
    SignatureExpired: 'The server signature expired — validate the run again.',
    WrongPayment: 'The price changed — refresh and try again.',
    ZeroAddress: 'Invalid zero address.',
    ZeroPrice: 'The price must be above zero.',
    ZeroStake: 'The stake must be above zero.',
};

interface ErrLike {
    name?: string;
    message?: string;
    shortMessage?: string;
    details?: string;
    code?: number;
    cause?: unknown;
    data?: { errorName?: string };
    errorName?: string;
}

function walk(e: unknown): ErrLike[] {
    const out: ErrLike[] = [];
    let cur: unknown = e;
    for (let i = 0; i < 8 && cur && typeof cur === 'object'; i++) {
        out.push(cur as ErrLike);
        cur = (cur as ErrLike).cause;
    }
    return out;
}

const USER_REJECTED = 'You rejected the request in your wallet.';
/** True when the message is the wallet-rejection one (the user clicked "Reject"), not a contract revert. */
export const isUserRejection = (message: string) => message === USER_REJECTED;

export function humanizeError(e: unknown): string {
    if (!e) return 'Something went wrong.';
    if (typeof e === 'string') return e;
    const chain = walk(e);
    const all = chain.map((c) => `${c.name ?? ''} ${c.shortMessage ?? ''} ${c.message ?? ''} ${c.details ?? ''}`).join(' | ');

    if (chain.some((c) => c.code === 4001 || c.name === 'UserRejectedRequestError') || /user (rejected|denied)|rejected the request|denied transaction/i.test(all)) {
        return USER_REJECTED;
    }
    if (/insufficient funds/i.test(all)) return 'Not enough ETH to pay for gas on this network.';
    if (/ChainMismatch|does not match the target chain|chain mismatch/i.test(all)) return 'Your wallet is on another network — switch networks and retry.';
    if (/ConnectorNotConnected|Connector not connected|connector not found/i.test(all)) return 'Connect your wallet first.';

    for (const c of chain) {
        const name = c.data?.errorName ?? c.errorName;
        if (name) return CUSTOM_ERRORS[name] ?? `The contract rejected the transaction (${name}).`;
    }
    const m = /reverted with (?:the following reason|custom error)[:\s]*['"]?([A-Za-z0-9_]+)/i.exec(all) ?? /error ([A-Z][A-Za-z0-9]+)\(/.exec(all);
    if (m) return CUSTOM_ERRORS[m[1]] ?? `The contract rejected the transaction (${m[1]}).`;
    if (/returned no data \("0x"\)|ContractFunctionZeroDataError|is not a contract|address is not a contract/i.test(all)) {
        return 'Contracts are not deployed on this network (or the address is wrong).';
    }
    if (/Failed to fetch|fetch failed|NetworkError|ECONNREFUSED|HTTP request failed|Load failed/i.test(all)) {
        return 'Network unreachable — is the local chain / server running?';
    }
    if (/timed? ?out/i.test(all)) return 'The request timed out — the network is slow or offline.';

    const first = chain[0];
    const status = (first as { status?: number }).status;
    if (status === 400 && /invalid body|validation/i.test(all)) return 'The server refused the request data (invalid body). Play the level again and resubmit.';
    if (status === 422) return `The server rejected the run: ${(first.message ?? '').replace(/^run rejected:?\s*/i, '')}`.trim();
    if (status === 409) return first.message ? `Conflict: ${first.message}` : 'This layout is already published.';
    if (status && status >= 500) return `The game server failed (${status}). Try again in a moment.`;
    const msg = first.shortMessage ?? first.message ?? String(e);
    return msg.split('\n')[0].slice(0, 180);
}
