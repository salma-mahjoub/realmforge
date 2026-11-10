import { describe, expect, it } from 'vitest';
import blockchainDoc from '../../../docs/BLOCKCHAIN.md?raw';
import { renderDoc, slugify } from './renderDoc';

const SAMPLE = `# The title

## 1. Big \`picture\`

See [the threat model](security/THREAT_MODEL.md), [EIP-712](https://eips.ethereum.org/EIPS/eip-712) and [above](#top).

\`\`\`mermaid
flowchart LR
    A["a <b>"] --> B
\`\`\`

\`\`\`text
plain code
\`\`\`
`;

describe('renderDoc', () => {
    it('collects the title and the ## sections with stable ids', () => {
        const doc = renderDoc(SAMPLE);
        expect(doc.title).toBe('The title');
        expect(doc.sections).toEqual([{ id: '1-big-picture', text: '1. Big picture' }]);
        expect(doc.html).toContain('<h2 id="1-big-picture">');
    });

    it('drops the title when asked', () => {
        expect(renderDoc(SAMPLE, { dropTitle: true }).html).not.toContain('<h1');
        expect(renderDoc(SAMPLE).html).toContain('<h1');
    });

    it('turns mermaid fences into escaped diagram blocks and leaves other code alone', () => {
        const doc = renderDoc(SAMPLE);
        expect(doc.diagrams).toBe(1);
        expect(doc.html).toContain('<pre class="mermaid">flowchart LR');
        expect(doc.html).toContain('A[&quot;a &lt;b&gt;&quot;]');
        expect(doc.html).toMatch(/<code class="language-text">plain code/);
    });

    it('keeps external and anchor links, and neutralises repository links without a base', () => {
        const doc = renderDoc(SAMPLE);
        expect(doc.html).toContain('href="https://eips.ethereum.org/EIPS/eip-712" target="_blank"');
        expect(doc.html).toContain('href="#top"');
        expect(doc.html).toContain('<span class="doc-ref" title="docs/security/THREAT_MODEL.md in the repository">');
        expect(renderDoc(SAMPLE, { repoBase: 'file:///repo/docs/' }).html).toContain('href="file:///repo/docs/security/THREAT_MODEL.md"');
    });

    it('slugifies headings the way the table of contents links them', () => {
        expect(slugify('7. Versus races (escrow)')).toBe('7-versus-races-escrow');
    });

    it('renders the real blockchain doc with every section and diagram', () => {
        const doc = renderDoc(blockchainDoc);
        expect(doc.title).toBe('How the blockchain side of RealmForge works');
        expect(doc.sections.length).toBeGreaterThanOrEqual(14);
        expect(doc.diagrams).toBe((blockchainDoc.match(/```mermaid/g) ?? []).length);
        expect(new Set(doc.sections.map((s) => s.id)).size).toBe(doc.sections.length);
    });
});
