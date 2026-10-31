import { useState } from 'react';
import { formatEther, parseEther } from 'viem';
import { ShoppingCart, Tag } from 'lucide-react';
import { useMarket } from '../contracts/hooks';
import { useTxFlow, useWeb3Status } from '../web3/tx';
import { BlockerNotice } from './BlockerNotice';
import { AddressChip, Button, Field, Input, Modal, TokenAmount } from './ui';

const ROYALTY_BPS = 500;

export function BuyModal({ open, onClose, levelId, levelName, priceWei, seller, creator, onDone, sample }: { open: boolean; onClose: () => void; levelId: number; levelName: string; priceWei: bigint | undefined; seller?: string; creator?: string; onDone?: () => void; sample?: boolean }) {
    const market = useMarket();
    const tx = useTxFlow();
    const web3 = useWeb3Status();
    const [error, setError] = useState<string | null>(null);
    const price = priceWei !== undefined ? Number(formatEther(priceWei)) : undefined;
    const royalty = price !== undefined ? (price * ROYALTY_BPS) / 10_000 : undefined;
    const own = web3.address && seller && web3.address.toLowerCase() === seller.toLowerCase();
    const busy = tx.isBusy('buy');

    const buy = async () => {
        if (priceWei === undefined) return;
        setError(null);
        const r = await tx.run('buy', { title: `Buy level #${levelId}`, success: `Level #${levelId} is yours`, successBody: 'The NFT was transferred to your wallet.' }, () => market.buy(BigInt(levelId), priceWei));
        if (r.ok) {
            onDone?.();
            onClose();
        } else setError(r.error ?? 'Purchase failed');
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            dismissible={!busy}
            size="sm"
            icon={<ShoppingCart size={20} />}
            title={`Buy #${levelId} ${levelName}`}
            description="Fixed-price sale through LevelNFT.buy(). The NFT moves to your wallet in the same transaction."
            footer={
                <>
                    <Button onClick={onClose} disabled={busy}>
                        Cancel
                    </Button>
                    <Button variant="primary" loading={busy} disabled={!!web3.blocker || priceWei === undefined || !!own} onClick={() => void buy()}>
                        {busy ? (tx.stage === 'signing' ? 'Confirm in wallet…' : 'Waiting for block…') : `Buy for ${price ?? '—'} ETH`}
                    </Button>
                </>
            }
        >
            <dl className="kv-list">
                <div>
                    <dt>Price</dt>
                    <dd>
                        <TokenAmount value={price} symbol="ETH" maxFrac={6} />
                    </dd>
                </div>
                <div>
                    <dt>Seller</dt>
                    <dd>
                        <AddressChip address={seller} />
                    </dd>
                </div>
                <div>
                    <dt>Creator royalty (5%, ERC-2981)</dt>
                    <dd>
                        {royalty !== undefined ? `${royalty.toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH` : '—'} to <AddressChip address={creator} copy={false} />
                    </dd>
                </div>
            </dl>
            <p className="fine">Proceeds are credited with the pull pattern: the seller and creator withdraw them later. You also pay network gas.</p>
            {own && <div className="notice notice-info">You own this level already.</div>}
            {sample && (
                <div className="notice notice-info" role="status">
                    <span>This listing is sample data (the server has no market endpoint yet), so the contract will most likely reject the purchase.</span>
                </div>
            )}
            <BlockerNotice />
            {error && (
                <div className="notice notice-error" role="alert">
                    {error}
                </div>
            )}
        </Modal>
    );
}

export function ListModal({ open, onClose, levelId, levelName, currentWei, onDone }: { open: boolean; onClose: () => void; levelId: number; levelName: string; currentWei?: bigint; onDone?: () => void }) {
    const market = useMarket();
    const tx = useTxFlow();
    const web3 = useWeb3Status();
    const [price, setPrice] = useState(currentWei ? formatEther(currentWei) : '0.05');
    const [error, setError] = useState<string | null>(null);
    let invalid: string | null = null;
    try {
        if (!price || parseEther(price) <= 0n) invalid = 'Enter a price above 0.';
    } catch {
        invalid = 'Enter a number, e.g. 0.05';
    }
    const n = Number(price) || 0;
    const busy = tx.isBusy('list') || tx.isBusy('unlist');

    const list = async () => {
        setError(null);
        const r = await tx.run('list', { title: `List level #${levelId}`, success: `Listed for ${price} ETH` }, () => market.list(BigInt(levelId), price));
        if (r.ok) {
            onDone?.();
            onClose();
        } else setError(r.error ?? 'Listing failed');
    };
    const unlist = async () => {
        setError(null);
        const r = await tx.run('unlist', { title: `Unlist level #${levelId}`, success: 'Listing removed' }, () => market.unlist(BigInt(levelId)));
        if (r.ok) {
            onDone?.();
            onClose();
        } else setError(r.error ?? 'Unlisting failed');
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            dismissible={!busy}
            size="sm"
            icon={<Tag size={20} />}
            title={currentWei ? `Update listing · #${levelId}` : `List #${levelId} ${levelName}`}
            description="No approval needed: the listing itself authorises buy(), and any transfer clears it."
            footer={
                <>
                    {currentWei ? (
                        <Button variant="danger" onClick={() => void unlist()} loading={tx.isBusy('unlist')} disabled={busy || !!web3.blocker}>
                            Unlist
                        </Button>
                    ) : (
                        <Button onClick={onClose} disabled={busy}>
                            Cancel
                        </Button>
                    )}
                    <Button variant="primary" loading={tx.isBusy('list')} disabled={!!invalid || busy || !!web3.blocker} onClick={() => void list()}>
                        {currentWei ? 'Update price' : 'List for sale'}
                    </Button>
                </>
            }
        >
            <Field label="Price" htmlFor="list-price" error={invalid} hint={`You receive ${(n * 0.95).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH after the 5% creator royalty (less if you are not the creator of a remix).`}>
                <Input id="list-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(',', '.'))} suffix="ETH" data-autofocus />
            </Field>
            <BlockerNotice />
            {error && (
                <div className="notice notice-error" role="alert">
                    {error}
                </div>
            )}
        </Modal>
    );
}
