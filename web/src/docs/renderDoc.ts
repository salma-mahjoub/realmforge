import { Marked } from 'marked';

/**
 * Markdown -> HTML for the docs shown in the app (/how-it-works) and exported to PDF
 * (scripts/export-doc-pdf.mjs). Both use this module so the page and the PDF cannot drift apart.
 * Mermaid fences become `<pre class="mermaid">` blocks that the caller renders with mermaid.
 * The input is our own repository file, so the HTML is trusted.
 */
export interface DocHeading {
    id: string;
    text: string;
}

export interface RenderedDoc {
    html: string;
    title: string;
    /** `##` headings, in order, for the table of contents. */
    sections: DocHeading[];
    diagrams: number;
}

export interface RenderOptions {
    /** Leave the `#` title out of the HTML (the page header shows it). */
    dropTitle?: boolean;
    /** Base URL for links to other repository files; without it they render as plain text. */
    repoBase?: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Heading text without Markdown marks, as shown in the table of contents. */
const plain = (s: string) => s.replace(/`/g, '').replace(/\*\*?/g, '').trim();

export const slugify = (s: string) =>
    plain(s)
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-');

export function renderDoc(markdown: string, { dropTitle = false, repoBase }: RenderOptions = {}): RenderedDoc {
    let title = '';
    const sections: DocHeading[] = [];
    let diagrams = 0;

    const md = new Marked({ gfm: true });
    md.use({
        renderer: {
            heading({ tokens, depth, text }) {
                const inner = this.parser.parseInline(tokens);
                if (depth === 1) {
                    title = plain(text);
                    if (dropTitle) return '';
                }
                const id = slugify(text);
                if (depth === 2) sections.push({ id, text: plain(text) });
                return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
            },
            code({ text, lang }) {
                if (lang !== 'mermaid') return false;
                diagrams += 1;
                return `<figure class="doc-diagram"><pre class="mermaid">${escapeHtml(text)}</pre></figure>\n`;
            },
            link({ href, tokens }) {
                const inner = this.parser.parseInline(tokens);
                if (/^https?:\/\//.test(href)) return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${inner}</a>`;
                if (href.startsWith('#')) return `<a href="${escapeHtml(href)}">${inner}</a>`;
                if (repoBase) return `<a href="${escapeHtml(repoBase + href)}">${inner}</a>`;
                return `<span class="doc-ref" title="docs/${escapeHtml(href)} in the repository">${inner}</span>`;
            },
        },
    });

    const html = md.parse(markdown, { async: false });
    return { html, title, sections, diagrams };
}
