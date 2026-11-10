import { useEffect, useMemo, useRef, useState } from 'react';
import { zeroAddress } from 'viem';
import { FileDown, FileCode2, Link2 } from 'lucide-react';
import blockchainDoc from '../../../docs/BLOCKCHAIN.md?raw';
import blockchainPdf from '../../../docs/RealmForge_Blockchain.pdf?url';
import { renderDoc } from '../docs/renderDoc';
import { getAddresses } from '../contracts/addresses';
import { explorerAddressUrl } from '../web3/config';
import { chainName, useWeb3Status } from '../web3/tx';
import { Badge, Card, CardHeader, ExternalLink, shortAddr } from '../components/ui';

/** Mermaid colours taken from tokens.css so the diagrams sit on the navy surface like the rest of the app. */
const MERMAID_THEME = {
    darkMode: true,
    background: '#151b30',
    fontFamily: "'Inter Variable', Inter, system-ui, sans-serif",
    primaryColor: '#1b2340',
    primaryBorderColor: '#7c5cff',
    primaryTextColor: '#eef0ff',
    secondaryColor: '#232c4f',
    tertiaryColor: '#151b30',
    lineColor: '#8d95bb',
    textColor: '#c3c8e6',
    clusterBkg: '#121831',
    clusterBorder: '#364273',
    edgeLabelBackground: '#232c4f',
    actorBkg: '#1b2340',
    actorBorder: '#7c5cff',
    actorTextColor: '#eef0ff',
    actorLineColor: '#5d668d',
    signalColor: '#c3c8e6',
    signalTextColor: '#eef0ff',
    labelBoxBkgColor: '#232c4f',
    labelTextColor: '#eef0ff',
    loopTextColor: '#c3c8e6',
    noteBkgColor: '#2b2546',
    noteTextColor: '#eef0ff',
    sequenceNumberColor: '#0f1424',
    transitionColor: '#8d95bb',
    transitionLabelColor: '#c3c8e6',
    stateLabelColor: '#eef0ff',
    pie1: '#7c5cff',
    pie2: '#ffc83d',
    pie3: '#22d3ee',
    pie4: '#ff5c7a',
    pieStrokeColor: '#151b30',
    pieOuterStrokeColor: '#364273',
    pieTitleTextColor: '#eef0ff',
    pieLegendTextColor: '#c3c8e6',
    pieSectionTextColor: '#0f1424',
};

let renderSeq = 0;

/** Replaces every `pre.mermaid` under `root` with its SVG. A block that fails keeps its source, styled as code. */
async function renderDiagrams(root: HTMLElement, isCancelled: () => boolean) {
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: MERMAID_THEME });
    for (const pre of Array.from(root.querySelectorAll<HTMLPreElement>('pre.mermaid'))) {
        if (isCancelled()) return;
        try {
            const { svg } = await mermaid.render(`doc-diagram-${++renderSeq}`, pre.textContent ?? '');
            if (isCancelled() || !pre.isConnected) return;
            const out = document.createElement('div');
            out.className = 'doc-diagram-svg';
            out.innerHTML = svg;
            pre.replaceWith(out);
        } catch (err) {
            pre.classList.add('is-failed');
            console.warn('[how-it-works] diagram failed to render', err);
        }
    }
}

/** Highlights the table-of-contents entry of the section being read. */
function useActiveSection(ids: string[]) {
    const [active, setActive] = useState(ids[0]);
    useEffect(() => {
        const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
        if (!els.length || typeof IntersectionObserver === 'undefined') return;
        const obs = new IntersectionObserver(
            (entries) => {
                const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
                if (top) setActive(top.target.id);
            },
            { rootMargin: '-80px 0px -65% 0px' },
        );
        els.forEach((el) => obs.observe(el));
        return () => obs.disconnect();
    }, [ids]);
    return active;
}

function LiveContracts() {
    const { chainId } = useWeb3Status();
    const addrs = getAddresses(chainId);
    const deployed = addrs.levelNFT !== zeroAddress && addrs.forgeCoin !== zeroAddress;
    const row = (name: string, address: string) => {
        const url = explorerAddressUrl(chainId, address);
        return (
            <li className="doc-contract">
                <span className="doc-contract-name">{name}</span>
                {url.startsWith('http') ? (
                    <ExternalLink href={url} title={address}>
                        {shortAddr(address)}
                    </ExternalLink>
                ) : (
                    <code title={address}>{shortAddr(address)}</code>
                )}
            </li>
        );
    };
    return (
        <Card className="doc-side-card">
            <CardHeader icon={<Link2 size={16} aria-hidden />} title="Live contracts" aside={<Badge tone={deployed ? 'green' : 'neutral'}>{chainName(chainId)}</Badge>} />
            {deployed ? (
                <ul className="doc-contracts">
                    {row('LevelNFT', addrs.levelNFT)}
                    {row('ForgeCoin', addrs.forgeCoin)}
                </ul>
            ) : (
                <p className="fine">No RealmForge deployment on this network. Section 13 lists the Sepolia addresses.</p>
            )}
        </Card>
    );
}

/** /how-it-works: docs/BLOCKCHAIN.md rendered in the app, with Mermaid diagrams and a PDF download. */
export default function HowItWorks() {
    const doc = useMemo(() => renderDoc(blockchainDoc, { dropTitle: true }), []);
    const ids = useMemo(() => doc.sections.map((s) => s.id), [doc]);
    const active = useActiveSection(ids);
    const articleRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const root = articleRef.current;
        if (!root) return;
        let cancelled = false;
        void renderDiagrams(root, () => cancelled);
        return () => {
            cancelled = true;
        };
    }, [doc]);

    return (
        <div className="page page-doc">
            <header className="page-head">
                <div>
                    <h1 className="page-title">{doc.title}</h1>
                    <p className="page-sub">
                        What RealmForge stores on-chain, what the game server signs, and where every FORGE of a play fee, a race pot or a level sale goes.
                    </p>
                </div>
                <div className="row">
                    <a className="btn btn-secondary btn-md" href={blockchainPdf} download="RealmForge_Blockchain.pdf">
                        <FileDown size={16} aria-hidden />
                        <span className="btn-label">Download PDF</span>
                    </a>
                </div>
            </header>

            <div className="doc-layout">
                <aside className="doc-side">
                    <nav className="doc-toc" aria-label="Sections">
                        <p className="doc-toc-title">
                            <FileCode2 size={14} aria-hidden /> On this page
                        </p>
                        <ol>
                            {doc.sections.map((s) => (
                                <li key={s.id}>
                                    <a href={`#${s.id}`} className={s.id === active ? 'active' : undefined} aria-current={s.id === active ? 'location' : undefined}>
                                        {s.text}
                                    </a>
                                </li>
                            ))}
                        </ol>
                    </nav>
                    <LiveContracts />
                </aside>
                <article ref={articleRef} className="doc-prose" dangerouslySetInnerHTML={{ __html: doc.html }} />
            </div>
        </div>
    );
}
