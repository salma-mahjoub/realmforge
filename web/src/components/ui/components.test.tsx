import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import type { Address } from 'viem';
import { Badge, Button, EmptyState, Field, Input, Pill, Stat, Switch } from './primitives';
import { Tabs, Tooltip } from './Tabs';
import { AddressChip, TokenAmount } from './web3';
import { Modal } from './Modal';
import { toast } from './Toast';
import { LevelCard, thumbFor } from '../LevelCard';
import { MOCK_LEVELS } from '../../data/mock';

const html = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

describe('UI components (static render)', () => {
    it('Button: variants, loading state and router links', () => {
        const busy = html(<Button variant="gold" loading>Claim</Button>);
        expect(busy).toContain('btn-gold');
        expect(busy).toContain('aria-busy="true"');
        expect(busy).toContain('disabled=""');
        expect(html(<Button to="/editor">Create</Button>)).toMatch(/<a [^>]*href="\/editor"/);
        // a disabled link renders as a real disabled button, not a clickable anchor
        expect(html(<Button to="/editor" disabled>Create</Button>)).toMatch(/<button[^>]*disabled/);
        expect(html(<Button>Go</Button>)).toContain('type="button"');
    });

    it('Badge, Pill, Stat, EmptyState render their semantics', () => {
        expect(html(<Badge tone="gold">NFT</Badge>)).toContain('tone-gold');
        expect(html(<Pill tone="green" pulse>LIVE</Pill>)).toContain('pulse');
        expect(html(<Stat label="Plays" value="1,284" />)).toContain('1,284');
        expect(html(<EmptyState tone="error" title="Failed" />)).toContain('role="alert"');
    });

    it('Field wires label, error and invalid state', () => {
        const out = html(
            <Field label="Price" htmlFor="p" error="Too low">
                <Input id="p" suffix="ETH" aria-invalid />
            </Field>,
        );
        expect(out).toContain('for="p"');
        expect(out).toContain('role="alert"');
        expect(out).toContain('ETH');
    });

    it('Switch and Tabs expose ARIA roles and selection', () => {
        expect(html(<Switch checked label="Loop" onChange={() => {}} />)).toContain('aria-checked="true"');
        const tabs = html(<Tabs label="Sort" value="b" onChange={() => {}} items={[{ id: 'a', label: 'New' }, { id: 'b', label: 'Popular', count: 3 }]} idBase="t" />);
        expect(tabs).toContain('role="tablist"');
        expect(tabs).toMatch(/id="t-tab-b"[^>]*aria-selected="true"[^>]*tabindex="0"/);
        expect(tabs).toMatch(/id="t-tab-a"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    });

    it('Tooltip attaches aria-describedby to its trigger', () => {
        const out = html(
            <Tooltip content="Undo" shortcut="⌘Z">
                <button type="button">u</button>
            </Tooltip>,
        );
        const id = /role="tooltip" id="([^"]+)"/.exec(out)?.[1];
        expect(id).toBeTruthy();
        expect(out).toContain(`aria-describedby="${id}"`);
    });

    it('TokenAmount and AddressChip format web3 values', () => {
        const amt = html(<TokenAmount value="1240" sign="+" />);
        expect(amt).toContain('+1,240');
        expect(amt).toContain('FORGE');
        expect(html(<TokenAmount value="0.05" symbol="ETH" maxFrac={6} />)).toContain('0.05');
        const chip = html(<AddressChip address={'0x7a3c5e2b9d14f08a6e1c3b7d5f9a2e4c6b8d91c4' as Address} />);
        expect(chip).toContain('0x7a3c…91c4');
        expect(chip).toContain('href="/profile/0x7a3c5e2b9d14f08a6e1c3b7d5f9a2e4c6b8d91c4"');
        expect(chip).toContain('aria-label="Copy address');
    });

    it('Modal renders an accessible dialog (inline) and hides when closed', () => {
        const open = html(
            <Modal open inline onClose={() => {}} title="Paused" description="Take a breath">
                body
            </Modal>,
        );
        expect(open).toContain('role="dialog"');
        expect(open).toContain('aria-modal="true"');
        expect(open).toMatch(/aria-labelledby="([^"]+)"[\s\S]*id="\1"/);
        expect(open).toContain('aria-label="Close dialog"');
        expect(html(<Modal open={false} inline onClose={() => {}} title="x" />)).toBe('');
        expect(html(<Modal open inline dismissible={false} onClose={() => {}} title="Busy" />)).not.toContain('Close dialog');
    });

    it('LevelCard uses a real game capture and labels its stats', () => {
        const lvl = MOCK_LEVELS[0];
        const out = html(<LevelCard level={lvl} />);
        expect(thumbFor(lvl)).toMatch(/^\/ui\/thumbs\/snow-[0-3]\.webp$/);
        expect(out).toContain(thumbFor(lvl));
        expect(out).toContain('width="640"');
        expect(out).toContain(`href="/level/${lvl.id}"`);
        expect(out).toContain('12% clear');
    });
});

describe('toast store', () => {
    it('updates a toast in place through its lifecycle', () => {
        const id = toast.show({ tone: 'pending', title: 'Claim: confirm in your wallet' });
        toast.update(id, { tone: 'success', title: 'Claimed' });
        toast.dismiss(id);
        toast.clear();
        expect(id).toMatch(/^t\d+$/);
    });
});
