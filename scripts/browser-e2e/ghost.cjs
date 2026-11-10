// Ghost replay browser verification: create one signed run, then race its trace on a second play.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript } = require('./wallet.cjs');
const fs = require('node:fs');
const path = require('node:path');
const player = process.env.PLAYER || '0x90f79bf6EB2c4f870365E785982E1f101E93b906';
const base = process.env.WEB_URL || 'http://localhost:8080';
const rpc = process.env.CHAIN_RPC || 'http://127.0.0.1:8545';
const exe = process.env.CHROME_PATH;
const screenshot = path.resolve(__dirname, '../../docs/screenshots/ghost/ghost-race.png');

(async () => {
  fs.mkdirSync(path.dirname(screenshot), { recursive: true });
  const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (error) => console.error('PAGEERROR', error.message));
  await page.addInitScript({ content: walletScript(player, rpc) });
  await page.goto(`${base}/play/1`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.waitForTimeout(1200);
  const faucet = page.getByRole('button', { name: /get 100 forge/i });
  if (await faucet.isVisible().catch(() => false)) {
    await faucet.click();
    await page.waitForTimeout(2500);
  }

  await page.getByRole('button', { name: /start run/i }).click();
  await page.waitForTimeout(1600);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Shift');
  const settle = page.getByRole('button', { name: /settle run/i });
  try { await settle.waitFor({ timeout: 20000 }); }
  finally { await page.keyboard.up('ArrowRight'); await page.keyboard.up('Shift'); }
  await settle.click();
  await page.getByRole('button', { name: /^settled$/i }).waitFor({ timeout: 60000 });
  console.log('first clear validated and signed; trace stored by GET /levels/1/replays');

  await page.goto(`${base}/play/1`, { waitUntil: 'networkidle' });
  await page.getByLabel('Race a replay').selectOption('record');
  await page.getByRole('button', { name: /start run/i }).click();
  await page.waitForTimeout(1700);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Shift');
  await page.waitForTimeout(1700);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('Shift');
  await page.screenshot({ path: screenshot });
  console.log(`ghost playback captured: ${screenshot}`);
  console.log('HUD:', await page.locator('canvas').count(), 'canvas; replay option selected');
  await browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
