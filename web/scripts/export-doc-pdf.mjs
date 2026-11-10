#!/usr/bin/env node
/**
 * Exports docs/BLOCKCHAIN.md to docs/RealmForge_Blockchain.pdf with the Mermaid diagrams rendered.
 *
 *   npm run doc:pdf                 (from web/)
 *   CHROME_PATH=/path/to/chrome npm run doc:pdf
 *
 * Uses the same Markdown renderer as the /how-it-works page (src/docs/renderDoc.ts, imported as TypeScript:
 * needs Node >= 22.18 for native type stripping) and headless Chrome's --print-to-pdf.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderDoc } from '../src/docs/renderDoc.ts';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = resolve(web, '../docs');
const source = join(docs, 'BLOCKCHAIN.md');
const output = join(docs, 'RealmForge_Blockchain.pdf');
const mermaidJs = join(web, 'node_modules/mermaid/dist/mermaid.min.js');

function findChrome() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const candidates = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ];
    // Chromium downloaded by Playwright (`npx playwright install chromium`).
    for (const cache of [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')]) {
        if (!existsSync(cache)) continue;
        for (const dir of readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
            candidates.push(
                join(cache, dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
                join(cache, dir, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
                join(cache, dir, 'chrome-linux/chrome'),
                join(cache, dir, 'chrome-linux64/chrome'),
            );
        }
    }
    return candidates.find((p) => existsSync(p));
}

const chrome = findChrome();
if (!chrome) {
    console.error('No Chrome or Chromium found. Install Google Chrome, run `npx playwright install chromium`, or set CHROME_PATH.');
    process.exit(1);
}
if (!existsSync(mermaidJs)) {
    console.error('mermaid is not installed: run `npm ci` in web/ first.');
    process.exit(1);
}

const { html, title, sections, diagrams } = renderDoc(readFileSync(source, 'utf8'), {
    dropTitle: true,
    repoBase: pathToFileURL(docs).href + '/',
});
const today = new Date().toISOString().slice(0, 10);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 18mm 16mm; }
  @page :first { margin: 0; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  :root { --navy: #0f1424; --violet: #7c5cff; --gold: #ffc83d; --ink: #1b2033; --muted: #5d668d; --line: #dfe2f0; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.55 -apple-system, 'Segoe UI', Inter, Roboto, sans-serif; color: var(--ink); }
  .cover { background: var(--navy); color: #eef0ff; padding: 40mm 22mm 20mm; height: 297mm; break-after: page; overflow: hidden; }
  .cover .kicker { color: var(--gold); letter-spacing: .14em; text-transform: uppercase; font-size: 9pt; font-weight: 700; }
  .cover h1 { font-size: 30pt; line-height: 1.1; margin: 10px 0 14px; }
  .cover p { color: #c3c8e6; max-width: 120mm; }
  .cover .meta { margin-top: 18mm; color: #8d95bb; font-size: 9pt; }
  .cover ol { columns: 2; column-gap: 10mm; margin: 14mm 0 0; padding-left: 18px; color: #c3c8e6; }
  .cover ol li { margin: 0 0 4px; break-inside: avoid; }
  .cover .bar { height: 4px; width: 60px; background: var(--violet); border-radius: 2px; }
  h2 { color: var(--navy); font-size: 16pt; margin: 22px 0 8px; padding-top: 6px; border-top: 3px solid var(--violet); break-after: avoid; }
  h3 { color: var(--navy); font-size: 12pt; margin: 16px 0 6px; break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  a { color: #5a3fe0; text-decoration: none; }
  code { font: 9pt/1.4 ui-monospace, Menlo, Consolas, monospace; background: #f2f0ff; padding: 1px 4px; border-radius: 4px; }
  pre:not(.mermaid) { background: #f6f7fb; border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; word-break: break-all; break-inside: avoid; }
  pre:not(.mermaid) code { background: none; padding: 0; font-size: 8pt; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9.5pt; break-inside: avoid; }
  th { text-align: left; background: #f2f0ff; color: var(--navy); }
  th, td { border: 1px solid var(--line); padding: 5px 7px; vertical-align: top; }
  blockquote { margin: 10px 0; padding: 8px 12px; border-left: 4px solid var(--gold); background: #fff8e4; break-inside: avoid; }
  blockquote p { margin: 0; }
  .doc-diagram { margin: 12px 0; padding: 10px; border: 1px solid var(--line); border-radius: 8px; text-align: center; break-inside: avoid; }
  .doc-diagram pre.mermaid { margin: 0; }
  .doc-diagram svg { max-width: 100%; height: auto; max-height: 200mm; }
  .doc-diagram svg[aria-roledescription='pie'] { max-width: 110mm; }
</style>
</head>
<body>
<section class="cover">
  <div class="kicker">RealmForge · Blockchain BK-01</div>
  <h1>${title}</h1>
  <div class="bar"></div>
  <p>Three contracts (two token contracts plus bounty escrow), one trusted signer, and how levels, runs, races, seasons and bounties settle on-chain.</p>
  <ol>${sections.map((s) => `<li>${s.text.replace(/^\d+\.\s*/, '')}</li>`).join('')}</ol>
  <div class="meta">Generated ${today} from docs/BLOCKCHAIN.md · ${diagrams} diagrams</div>
</section>
${html}
<script src="${pathToFileURL(mermaidJs).href}"></script>
<script>
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: '-apple-system, Segoe UI, Inter, Roboto, sans-serif',
    themeVariables: {
      primaryColor: '#efeaff', primaryBorderColor: '#7c5cff', primaryTextColor: '#0f1424',
      lineColor: '#5d668d', secondaryColor: '#fff4d1', tertiaryColor: '#f6f7fb',
      actorBkg: '#efeaff', actorBorder: '#7c5cff', signalColor: '#1b2033', noteBkgColor: '#fff4d1',
      pie1: '#7c5cff', pie2: '#ffc83d', pie3: '#22d3ee', pie4: '#ff5c7a', pieStrokeColor: '#ffffff',
    },
    flowchart: { useMaxWidth: true, htmlLabels: true },
    sequence: { useMaxWidth: true },
  });
  mermaid.run({ querySelector: 'pre.mermaid' })
    .then(() => { document.title = 'READY'; })
    .catch((e) => { document.body.insertAdjacentHTML('afterbegin', '<p id="mermaid-error">' + e + '</p>'); document.title = 'ERROR'; });
</script>
</body>
</html>`;

const tmp = mkdtempSync(join(tmpdir(), 'rf-doc-'));
const htmlFile = join(tmp, 'blockchain.html');
writeFileSync(htmlFile, page);

try {
    const common = ['--headless', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', '--virtual-time-budget=30000'];
    // Check that every diagram rendered before printing: a broken Mermaid block would otherwise print as raw text.
    const dom = execFileSync(chrome, [...common, '--dump-dom', pathToFileURL(htmlFile).href], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    const rendered = (dom.match(/<svg[^>]+id="mermaid-/g) ?? []).length;
    if (!dom.includes('<title>READY</title>') || rendered < diagrams) {
        throw new Error(`only ${rendered} of ${diagrams} Mermaid diagrams rendered`);
    }
    execFileSync(chrome, [...common, '--no-pdf-header-footer', `--print-to-pdf=${output}`, pathToFileURL(htmlFile).href], { stdio: ['ignore', 'ignore', 'ignore'] });
    if (!existsSync(output) || statSync(output).size === 0) throw new Error('Chrome did not write the PDF');
    console.log(`Wrote ${output} (${(statSync(output).size / 1024).toFixed(0)} kB, ${sections.length} sections, ${diagrams} diagrams)`);
} finally {
    rmSync(tmp, { recursive: true, force: true });
}
