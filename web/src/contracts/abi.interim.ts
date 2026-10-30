/**
 * INTERIM hand-written ABI fragments from SPEC §4–§5, used only until contracts/ exports the real
 * ABIs into ./generated/. Keep in sync with the spec; delete once generated ABIs land.
 */

const runResultComponents = [
    { name: 'player', type: 'address' },
    { name: 'levelId', type: 'uint256' },
    { name: 'timeMs', type: 'uint32' },
    { name: 'cleared', type: 'bool' },
    { name: 'coins', type: 'uint16' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
] as const;

export const levelNftAbiInterim = [
    {
        type: 'function',
        name: 'levels',
        stateMutability: 'view',
        inputs: [{ name: 'id', type: 'uint256' }],
        outputs: [
            { name: 'creator', type: 'address' },
            { name: 'layoutHash', type: 'bytes32' },
            { name: 'parentId', type: 'uint256' },
            { name: 'playFee', type: 'uint96' },
            { name: 'plays', type: 'uint32' },
            { name: 'clears', type: 'uint32' },
            { name: 'likes', type: 'uint32' },
            { name: 'bestTimeMs', type: 'uint32' },
            { name: 'bestPlayer', type: 'address' },
            { name: 'active', type: 'bool' },
        ],
    },
    {
        type: 'function',
        name: 'levelInfo',
        stateMutability: 'view',
        inputs: [{ name: 'id', type: 'uint256' }],
        outputs: [
            { name: 'owner', type: 'address' },
            { name: 'creator', type: 'address' },
            { name: 'playFee', type: 'uint96' },
            { name: 'active', type: 'bool' },
        ],
    },
    { type: 'function', name: 'tokenURI', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'string' }] },
    { type: 'function', name: 'ownerOf', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
    { type: 'function', name: 'listingPrice', stateMutability: 'view', inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
    { type: 'function', name: 'nextId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
    {
        type: 'function',
        name: 'publish',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'layoutHash', type: 'bytes32' },
            { name: 'uri', type: 'string' },
            { name: 'playFee', type: 'uint96' },
            { name: 'parentId', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
            { name: 'clearSig', type: 'bytes' },
        ],
        outputs: [{ name: 'id', type: 'uint256' }],
    },
    { type: 'function', name: 'like', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
    { type: 'function', name: 'list', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'priceWei', type: 'uint256' }], outputs: [] },
    { type: 'function', name: 'unlist', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
    { type: 'function', name: 'buy', stateMutability: 'payable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
    { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [], outputs: [] },
    {
        type: 'event',
        name: 'LevelPublished',
        inputs: [
            { name: 'id', type: 'uint256', indexed: true },
            { name: 'creator', type: 'address', indexed: true },
            { name: 'layoutHash', type: 'bytes32', indexed: false },
            { name: 'parentId', type: 'uint256', indexed: false },
            { name: 'playFee', type: 'uint96', indexed: false },
        ],
    },
] as const;

export const forgeCoinAbiInterim = [
    { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
    { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
    { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
    { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
    { type: 'function', name: 'faucetClaimed', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
    { type: 'function', name: 'claimFaucet', stateMutability: 'nonpayable', inputs: [], outputs: [] },
    {
        type: 'function',
        name: 'settleRun',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'r', type: 'tuple', components: runResultComponents },
            { name: 'sig', type: 'bytes' },
        ],
        outputs: [],
    },
    {
        type: 'event',
        name: 'RunSettled',
        inputs: [
            { name: 'player', type: 'address', indexed: true },
            { name: 'levelId', type: 'uint256', indexed: true },
            { name: 'timeMs', type: 'uint32', indexed: false },
            { name: 'cleared', type: 'bool', indexed: false },
            { name: 'reward', type: 'uint256', indexed: false },
            { name: 'feePaid', type: 'uint256', indexed: false },
        ],
    },
    { type: 'event', name: 'FaucetClaimed', inputs: [{ name: 'user', type: 'address', indexed: true }] },
] as const;
