// Browser E2E, season close (admin): live standings → fetch the signed result → closeSeason refused before the end
// (button disabled) → `npm run season:ff` (local-only clock jump) → close from the admin wallet → payouts shown and
// checked against the on-chain balances.
// Needs a running local stack with at least one settled run (e.g. `npm run e2e:chain` or player.cjs).
// Env: WEB_URL (default http://localhost:8080), RPC_URL (default http://127.0.0.1:8545), ADMIN (Hardhat #0).
const { execFileSync } = require('child_process');
const { resolve } = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript } = require('./wallet.cjs');
const EXE = process.env.CHROME_PATH || undefined;
const WEB = (process.env.WEB_URL || 'http://localhost:8080').replace(/\/$/, '');
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const ADMIN = process.env.ADMIN || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Hardhat #0, the deployer (DEFAULT_ADMIN_ROLE)
const env = Object.fromEntries(fs.readFileSync(resolve(__dirname, '../../web/.env.local'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')));
const API = (env.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '');
fs.mkdirSync(`${__dirname}/shots`, { recursive: true });
const shot = (p, n) => p.screenshot({ path: `${__dirname}/shots/${n}.png`, fullPage: true }).then(() => console.log('shot', `scripts/browser-e2e/shots/${n}.png`));
const call = async (data) => {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: env.VITE_FORGE_COIN_ADDRESS, data }, 'latest'] }) });
  return BigInt((await r.json()).result);
};
const balance = (a) => call('0x70a08231' + a.slice(2).toLowerCase().padStart(64, '0'));
let failures = 0;
const check = (label, ok, detail = '') => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` (${detail})` : ''}`); if (!ok) failures++; };

(async () => {
  const standings = await (await fetch(`${API}/season/standings`)).json();
  const winners = [...standings.players, ...standings.creators].filter((x) => x.winner);
  console.log(`season ${standings.season}: ${standings.players.length} players, ${standings.creators.length} creators scoring`);
  const before = await Promise.all(winners.map((w) => balance(w.address)));

  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript({ content: walletScript(ADMIN, RPC) });
  await page.goto(`${WEB}/season`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.getByRole('heading', { name: /admin: close the season/i }).waitFor({ timeout: 20000 });
  await page.getByRole('table', { name: 'Player standings' }).waitFor();
  const countdown = await page.getByTestId('season-countdown').innerText();
  check('countdown shows the time left', /\d+d \d+h \d\dm \d\ds/.test(countdown), countdown);
  await shot(page, '60-season-live');

  await page.getByRole('button', { name: /fetch signed result/i }).click();
  await page.getByLabel('Signed season result').waitFor({ timeout: 10000 });
  const close = page.getByRole('button', { name: /close season \d+/i });
  check('Close season is disabled before seasonEnd (SeasonNotOver)', await close.isDisabled());

  console.log('\n$ npm run season:ff');
  execFileSync('npx', ['tsx', 'scripts/season-fast-forward.ts'], { cwd: resolve(__dirname, '../../server'), stdio: 'inherit', env: { ...process.env, RPC_URL: RPC } });
  await page.waitForFunction(() => /Ended · awaiting close/.test(document.body.innerText), null, { timeout: 30000 });
  check('countdown follows the chain clock after the fast-forward', (await page.getByTestId('season-countdown').innerText()) === 'ended');
  await shot(page, '61-season-ended');

  await close.waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Close season \d+/.test(b.textContent) && !b.disabled), null, { timeout: 15000 });
  await close.click();
  await page.getByRole('heading', { name: /season \d+ payouts/i }).waitFor({ timeout: 30000 });
  const rows = await page.getByRole('table', { name: 'Season payouts' }).locator('tbody tr').count();
  check('payouts table lists every winner', rows === winners.length, `${rows} rows`);
  await shot(page, '62-season-payouts');

  const after = await Promise.all(winners.map((w) => balance(w.address)));
  winners.forEach((w, i) => check(`${w.address.slice(0, 8)}… was paid on-chain`, after[i] > before[i], `+${Number(after[i] - before[i]) / 1e18} FORGE`));
  const season = await call('0xc50b0fb0'); // season()
  check('the contract moved to the next season', season === BigInt(standings.season + 1), `season ${season}`);
  // the indexer picks up SeasonClosed + its transfers (watch polling: a few seconds) → "Past seasons"
  let closed = {};
  for (let i = 0; i < 30 && !closed.payouts; i++) {
    const r = await fetch(`${API}/season/${standings.season}/payouts`);
    if (r.ok) closed = await r.json();
    else await new Promise((ok) => setTimeout(ok, 1000));
  }
  check('server indexed the payouts', closed.payouts?.length === winners.length, `${closed.payouts?.length} payouts`);
  await page.getByText(`block ${closed.block}`).waitFor({ timeout: 20000 }).catch(() => console.log('  (past seasons not refreshed yet)'));
  await shot(page, '63-season-history');
  await browser.close();
  console.log(failures ? `\nSEASON BROWSER E2E FAILED (${failures})` : '\nSEASON BROWSER E2E OK');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
