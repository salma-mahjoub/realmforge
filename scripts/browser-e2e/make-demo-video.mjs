#!/usr/bin/env node
// Cut the recorded browser scenarios (record.cjs + run-all.mjs with RECORD_DIR) into one 1080p MP4 demo.
// Usage: RECORD_DIR=~/realmforge-demo-rec node make-demo-video.mjs [out.mp4]
// Needs ffmpeg on PATH and Playwright (PLAYWRIGHT_MODULE / CHROME_PATH as for the scenarios) to render title cards.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const DIR = resolve(process.env.RECORD_DIR ?? '');
const OUT = resolve(process.argv[2] ?? join(DIR, 'realmforge-demo.mp4'));
const SPEED = Number(process.env.DEMO_SPEED ?? 1.25); // footage played slightly faster: waits for blocks are dull
const W = 1920, H = 1080;
if (!existsSync(join(DIR, 'manifest.jsonl'))) throw new Error(`no manifest in ${DIR}: run run-all.mjs with RECORD_DIR first`);

/** Scenario label (run-all.mjs) → card copy and layout. `split`: the pages ran at the same time, show them side by side. */
const SCENES = {
    'publish level #1': { title: 'Build & publish a level NFT', sub: 'Clear it in test play → the server re-checks the run and signs an EIP-712 ClearProof → LevelNFT.publish mints the ERC-721', who: ['Creator'] },
    'play + settle #1': { title: 'A friend plays and pays', sub: 'Faucet FORGE → play → the server validates the trace → settleRun: 70% fee to the owner, reward minted to the player', who: ['Player'] },
    'remix #1 → #2': { title: 'Remix: on-chain provenance', sub: 'Copy the level, change it, publish it as a child NFT (parentId) — the parent creator shares the resale royalty', who: ['Remixer'] },
    'ghost replay on #1': { title: 'Race the record ghost', sub: 'The stored, server-validated run replays deterministically next to you', who: ['Player'] },
    'sell + withdraw #1': { title: 'Sell the NFT, withdraw royalties', sub: 'List → buy → pull-pattern withdraw (5% ERC-2981 royalty to the creator)', who: ['Seller', 'Buyer'] },
    '1v1 staked race': { title: '1v1 staked race', sub: 'Stakes escrowed in ForgeCoin → live race on Colyseus → the server signs the ranking → on-chain payout 60/25/10/5', who: ['Host', 'Guest'], split: true },
    'SIWE room auth': { title: 'Sign-In With Ethereum', sub: 'Rooms refuse unsigned joins; one free EIP-4361 signature proves the wallet', who: ['Host', 'Guest'], split: true },
    'publish co-op level #3': { title: 'Publish a co-op level', sub: 'A level with a halfway checkpoint and a pit', who: ['Creator'] },
    'co-op duo on #3': { title: 'Co-op mode', sub: 'Shared checkpoints: a fall respawns you where your teammate got to — team clear, reward claimed on-chain', who: ['Player 1', 'Player 2'], split: true },
    'season close': { title: 'Season close', sub: 'Live standings → admin closes the season with a signed result → the pool is paid out', who: ['Admin'] },
};

const rows = readFileSync(join(DIR, 'manifest.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const byLabel = new Map();
for (const r of rows) {
    if (!existsSync(r.path)) continue;
    if (!byLabel.has(r.label)) byLabel.set(r.label, []);
    byLabel.get(r.label).push(r);
}
for (const list of byLabel.values()) list.sort((a, b) => a.startedAt - b.startedAt || a.index - b.index);

const work = join(DIR, '_cut');
mkdirSync(work, { recursive: true });
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

// ---- title cards rendered as HTML (this ffmpeg has no drawtext) ----
const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await pw.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const css = `*{margin:0;box-sizing:border-box}body{width:${W}px;height:${H}px;background:radial-gradient(1200px 700px at 30% 20%,#2a1f5c 0%,#0b1020 60%);color:#fff;font-family:-apple-system,'SF Pro Display','Helvetica Neue',sans-serif;display:flex;flex-direction:column;justify-content:center;padding:0 160px}
.k{font-size:30px;letter-spacing:.18em;text-transform:uppercase;color:#ffc83d;font-weight:700}.t{font-size:96px;font-weight:800;margin:18px 0 26px;line-height:1.05}.s{font-size:38px;color:#c9cfe6;max-width:1500px;line-height:1.35}
.foot{position:absolute;bottom:60px;left:160px;font-size:26px;color:#7c86a8}.lab{position:absolute;top:0;width:${W / 2}px;text-align:center;font-size:30px;font-weight:700;color:#ffc83d;padding-top:${(H - 600) / 2 - 56}px}`;
async function card(file, kicker, title, sub, foot = 'RealmForge · Blockchain BK-01') {
    await page.setContent(`<style>${css}</style><div class="k">${kicker}</div><div class="t">${title}</div><div class="s">${sub}</div><div class="foot">${foot}</div>`);
    await page.screenshot({ path: file });
}
async function splitBg(file, a, b) {
    await page.setContent(`<style>${css}body{padding:0}</style><div class="lab" style="left:0">${a}</div><div class="lab" style="left:${W / 2}px">${b}</div>`);
    await page.screenshot({ path: file });
}
const still = (png, seconds, out) => ff(['-loop', '1', '-t', String(seconds), '-i', png, '-vf', `fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', out]);
const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0b1020`;

const segments = [];
await card(join(work, 'intro.png'), 'Live demo · local Hardhat chain', 'RealmForge', 'A Mario-Maker-style platformer where every level is an NFT and every play moves FORGE tokens.<br>Recorded end to end in a real browser with real wallet signatures.');
still(join(work, 'intro.png'), 4, join(work, '000-intro.mp4'));
segments.push(join(work, '000-intro.mp4'));

let n = 1;
for (const [label, meta] of Object.entries(SCENES)) {
    const vids = byLabel.get(label);
    if (!vids?.length) { console.warn(`(no footage for "${label}")`); continue; }
    const id = String(n++).padStart(3, '0');
    await card(join(work, `${id}-card.png`), `Step ${n - 1}`, meta.title, meta.sub);
    still(join(work, `${id}-card.png`), 3, join(work, `${id}-a-card.mp4`));
    segments.push(join(work, `${id}-a-card.mp4`));
    const speed = `setpts=PTS/${SPEED},fps=30`;
    if (meta.split && vids.length >= 2) {
        // side by side over a captioned background; the shorter page freezes on its last frame
        const [a, b] = vids;
        const bg = join(work, `${id}-bg.png`);
        await splitBg(bg, meta.who[0] ?? 'A', meta.who[1] ?? 'B');
        const len = Math.max(dur(a.path), dur(b.path)) / SPEED;
        const cell = `scale=944:-2,${speed},tpad=stop_mode=clone:stop_duration=600`;
        ff(['-loop', '1', '-i', bg, '-i', a.path, '-i', b.path, '-filter_complex',
            `[1:v]${cell}[l];[2:v]${cell}[r];[0:v]fps=30[bg];[bg][l]overlay=8:(H-h)/2[t];[t][r]overlay=W/2+8:(H-h)/2,format=yuv420p[v]`,
            '-map', '[v]', '-t', len.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', join(work, `${id}-b.mp4`)]);
        segments.push(join(work, `${id}-b.mp4`));
    } else {
        vids.forEach((v, i) => {
            const out = join(work, `${id}-b${i}.mp4`);
            ff(['-i', v.path, '-vf', `${speed},${fit},format=yuv420p`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', out]);
            segments.push(out);
        });
    }
}
await card(join(work, 'outro.png'), 'Under the hood', 'Five contracts, one game', 'LevelNFT (ERC-721 + ERC-2981) · ForgeCoin (ERC-20 + Permit) · LevelAuction · LevelBounty · RealmBadges (soulbound ERC-1155)<br>EIP-712 server signatures · SIWE · Colyseus rooms · indexer · all of it tested.', process.env.DEMO_FOOT ?? 'RealmForge · Blockchain BK-01');
still(join(work, 'outro.png'), 5, join(work, '999-outro.mp4'));
segments.push(join(work, '999-outro.mp4'));
await browser.close();

writeFileSync(join(work, 'list.txt'), segments.map((s) => `file '${s}'`).join('\n') + '\n');
ff(['-f', 'concat', '-safe', '0', '-i', join(work, 'list.txt'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT]);
console.log(`✔ ${OUT} (${dur(OUT).toFixed(0)} s, ${segments.length} segments)`);
