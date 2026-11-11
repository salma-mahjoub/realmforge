// Browser E2E, room sign-in: a host opens a room (SIWE from Node), a guest who declines the sign-in signature sees
// the "wallet signature required" notice, then signs and joins the live room.
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript, WEB } = require('./wallet.cjs');
const srv = (m) => require(path.resolve(__dirname, '../../server/node_modules', m));
const { Client } = srv('colyseus.js');
const { privateKeyToAccount } = srv('viem/accounts');
const { createSiweMessage } = srv('viem/siwe');
const EXE = process.env.CHROME_PATH || undefined;
const env = Object.fromEntries(require('fs').readFileSync(path.resolve(__dirname, '../../web/.env.local'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')));
const API = env.VITE_API_URL || 'http://localhost:8787';
const GAME = env.VITE_GAME_SERVER_URL || 'ws://localhost:2567';
const HOST = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'); // PUBLIC Hardhat key #3
const GUEST = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'; // #5
const LEVEL = Number(process.argv[2] || '1');
const shot = (p, n) => p.screenshot({ path: `${__dirname}/shots/${n}.png` }).then(() => console.log('shot', n));

(async () => {
  // host: EIP-4361 sign-in against the API, then create a room with the session token
  const { nonce } = await (await fetch(`${API}/auth/nonce`)).json();
  const domain = new URL(WEB).host;
  const message = createSiweMessage({ domain, address: HOST.address, uri: WEB, version: '1', chainId: 31337, nonce, issuedAt: new Date() });
  const verify = await fetch(`${API}/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', origin: WEB }, body: JSON.stringify({ message, signature: await HOST.signMessage({ message }) }) });
  const { token, error } = await verify.json();
  if (!token) throw new Error(`host sign-in failed: ${error}`);
  const client = new Client(GAME);
  const unsigned = await client.create('race', { address: HOST.address, levelId: LEVEL }).then(() => 'joined', (e) => `${e.code} ${e.message}`);
  console.log('unsigned create ->', unsigned);
  if (!/^4401 /.test(unsigned)) throw new Error('an unsigned create was not refused');
  const room = await client.create('race', { address: HOST.address, token, levelId: LEVEL });
  room.onMessage('*', () => {});
  console.log('room', room.roomId);

  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript({ content: walletScript(GUEST) + ';window.__rejectSign = true;' });
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.getByText(/Sign in with Ethereum/).first().waitFor({ timeout: 15000 });
  await shot(page, '40-siwe-banner');
  await page.goto(`${WEB}/room/${room.roomId}`, { waitUntil: 'load' });
  await page.getByText(/Wallet signature required/).waitFor({ timeout: 20000 });
  console.log('notice:', (await page.locator('.notice-error').first().innerText()).replace(/\s+/g, ' '));
  await shot(page, '41-room-signature-required');

  await page.evaluate(() => { window.__rejectSign = false; });
  await page.getByRole('button', { name: /sign in and join/i }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Wallet signature required'), null, { timeout: 20000 });
  await page.waitForFunction(() => /0x90F7/.test(document.body.innerText) && /0x9965/.test(document.body.innerText), null, { timeout: 20000 }).catch(() => {});
  // the server's state patch can trail the page by a tick: poll for up to 5 s
  for (let i = 0; i < 25 && room.state.players.size < 2; i++) await new Promise((r) => setTimeout(r, 200));
  await page.waitForTimeout(1500); // let the stage remount after the re-join before the screenshot
  const players = room.state.players.size;
  console.log('players in the server room after signing:', players);
  await shot(page, '42-room-joined');
  if (players !== 2) throw new Error(`expected 2 players, got ${players}`);
  await room.leave();
  await browser.close();
  console.log('✔ siwe room flow ok');
})().catch((e) => { console.error(e); process.exit(1); });
