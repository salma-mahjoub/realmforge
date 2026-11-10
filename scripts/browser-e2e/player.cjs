// Browser E2E, player half: faucet → play level #N → clear → settle run on-chain (fee to the level owner).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript } = require('./wallet.cjs');
const EXE = process.env.CHROME_PATH || undefined; // default: Playwright's bundled Chromium
const PLAYER = process.env.PLAYER || '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // Hardhat #3
const LEVEL = process.argv[2] || '1';
const shot = (p, n) => p.screenshot({ path: `${__dirname}/shots/${n}.png` }).then(() => console.log('shot', n));
const RPC = 'http://127.0.0.1:8545';
const env = Object.fromEntries(require('fs').readFileSync(require('path').resolve(__dirname, '../../web/.env.local'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')));
async function balance(addr) {
  const data = '0x70a08231' + addr.slice(2).toLowerCase().padStart(64, '0');
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: env.VITE_FORGE_COIN_ADDRESS, data }, 'latest'] }) });
  return Number(BigInt((await r.json()).result) / 10n ** 15n) / 1000;
}

(async () => {
  const CREATOR = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
  console.log('before: creator', await balance(CREATOR), 'player', await balance(PLAYER));
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript({ content: walletScript(PLAYER) });
  await page.goto(`http://localhost:8080/level/${LEVEL}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.waitForTimeout(2000);
  await shot(page, '10-level-page');

  const faucet = page.getByRole('button', { name: /get 100 forge/i });
  if (await faucet.isVisible().catch(() => false)) {
    await faucet.click();
    await page.waitForFunction(() => !/Get 100 FORGE/.test(document.querySelector('header')?.innerText ?? ''), null, { timeout: 30000 }).catch(() => console.log('faucet button still visible'));
    console.log('after faucet: player', await balance(PLAYER));
  }

  await page.goto(`http://localhost:8080/play/${LEVEL}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /start run/i }).click();
  await page.waitForTimeout(1200);
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('Shift');
  const settleBtn = page.getByRole('button', { name: /settle run/i });
  await settleBtn.waitFor({ timeout: 20000 }).finally(async () => { await page.keyboard.up('ArrowRight'); await page.keyboard.up('Shift'); });
  await page.waitForTimeout(1500); // server validation of the trace
  await shot(page, '11-cleared');
  await settleBtn.click();
  await page.getByRole('button', { name: /^settled$/i }).waitFor({ timeout: 60000 }).catch(async () => console.log('NOT SETTLED', (await page.locator('[role=dialog]').innerText().catch(() => '')).slice(0, 800)));
  await page.waitForTimeout(800);
  await shot(page, '12-settled');
  console.log('wallet calls', (await page.evaluate(() => window.__walletLog)).filter((m) => /send|sign|request/i.test(m)));
  console.log('after: creator', await balance(CREATOR), 'player', await balance(PLAYER));
  await browser.close();
})();
