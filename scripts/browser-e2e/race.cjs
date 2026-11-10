// Browser E2E, 1v1 race: host creates a staked room, guest joins + escrows, both ready, both race, payout on-chain.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript, WEB, RPC } = require('./wallet.cjs');
const EXE = process.env.CHROME_PATH || undefined; // default: Playwright's bundled Chromium
const HOST = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // #3 (has FORGE)
const GUEST = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'; // #5 (fresh)
const LEVEL = process.argv[2] || '2';
// Rooms require a SIWE sign-in: the test wallet forwards personal_sign to the Hardhat node, so it signs silently.
const signs = (p) => p.evaluate(() => (window.__walletLog || []).filter((m) => m === 'personal_sign').length);
const shot = (p, n) => p.screenshot({ path: `${__dirname}/shots/${n}.png` }).then(() => console.log('shot', n));
const env = Object.fromEntries(require('fs').readFileSync(require('path').resolve(__dirname, '../../web/.env.local'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')));
async function forge(addr) {
  const data = '0x70a08231' + addr.slice(2).toLowerCase().padStart(64, '0');
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: env.VITE_FORGE_COIN_ADDRESS, data }, 'latest'] }) });
  return Number(BigInt((await r.json()).result) / 10n ** 15n) / 1000;
}
/** Claims the 100 FORGE faucet when the wallet holds none (fresh chain: the race needs a stake). */
async function topUp(page) {
  const faucet = page.getByRole('button', { name: /get 100 forge/i });
  if (await faucet.isVisible().catch(() => false)) { await faucet.click(); await page.getByText(/100 FORGE/).first().waitFor(); await page.waitForTimeout(3000); }
}
async function session(browser, addr, path) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(addr.slice(0, 6), 'PAGEERROR', e.message));
  page.on('response', (r) => r.status() >= 400 && !/walletconnect|reown|web3modal/.test(r.url()) && console.log(addr.slice(0, 6), 'HTTP', r.status(), r.url().slice(0, 140)));
  page.on('console', (m) => (m.type() === 'error' && !/Failed to load resource|Reown|Lit is/.test(m.text())) && console.log(addr.slice(0, 6), m.type(), m.text().slice(0, 240)));
  await page.addInitScript({ content: walletScript(addr) });
  await page.goto(WEB + path, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.waitForTimeout(1500);
  return page;
}
const run = async (page, ms) => {
  await page.locator('canvas').first().click({ position: { x: 20, y: 20 } }).catch(() => {});
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('Shift');
  await page.waitForTimeout(ms);
  await page.keyboard.up('ArrowRight'); await page.keyboard.up('Shift');
};

(async () => {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  console.log('FORGE before: host', await forge(HOST), 'guest', await forge(GUEST));
  const host = await session(browser, HOST, '/room/new');
  await topUp(host);
  await host.locator('#room-level').selectOption(LEVEL).catch((e) => console.log('select', e.message));
  await host.locator('#room-stake').fill('10');
  await shot(host, '30-create-room');
  await host.getByRole('button', { name: /create room and stake/i }).click();
  await host.waitForURL(/\/room\/(?!new)[A-Z0-9]+/, { timeout: 60000 });
  const code = host.url().split('/room/')[1];
  console.log('room', code, '| host SIWE signatures:', await signs(host));
  await host.waitForTimeout(2000);

  const guest = await session(browser, GUEST, '/');
  await topUp(guest);
  await guest.goto(`${WEB}/room/${code}`, { waitUntil: 'load' });
  await guest.waitForTimeout(2500);
  await shot(guest, '31-guest-lobby');
  console.log('guest SIWE signatures:', await signs(guest));
  if (await guest.getByText(/wallet signature required/i).isVisible().catch(() => false)) throw new Error('guest join refused: no SIWE session');
  await guest.getByRole('button', { name: /join and escrow/i }).click();
  await guest.getByRole('button', { name: /i.m ready/i }).waitFor({ timeout: 60000 });
  await guest.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /join and escrow/i.test(b.innerText)), null, { timeout: 60000 });
  await guest.waitForTimeout(1500);
  await host.getByRole('button', { name: /i.m ready/i }).click();
  await guest.getByRole('button', { name: /i.m ready/i }).click();
  await shot(host, '32-ready');
  await host.waitForTimeout(1500); await shot(host, '32b-countdown-host');
  await host.getByRole('button', { name: /race in progress/i }).waitFor({ timeout: 20000 });
  await host.waitForTimeout(400);
  await shot(host, '32c-start-host'); await shot(guest, '32d-start-guest');
  // host sprints, guest is a beat behind
  await Promise.all([run(host, 4500), (async () => { await guest.waitForTimeout(700); await run(guest, 4500); })(), (async () => { await host.waitForTimeout(1300); await shot(host, '32e-running-host'); await shot(guest, '32f-running-guest'); })()]);
  await host.waitForTimeout(1500);
  await shot(host, '33-race-mid'); await shot(guest, '33b-race-mid-guest');
  await host.getByText(/Race finished/).waitFor({ timeout: 40000 }).catch(async () => console.log('no result yet', (await host.locator('main').innerText()).slice(0, 600)));
  await shot(host, '34-finished');
  await host.getByRole('button', { name: /settle on-chain/i }).click();
  await host.getByRole('button', { name: /paid out/i }).waitFor({ timeout: 60000 });
  await host.waitForTimeout(1500);
  await shot(host, '35-paid');
  console.log('FORGE after: host', await forge(HOST), 'guest', await forge(GUEST));
  await browser.close();
})();
