// Browser E2E, market: owner lists level #N → buyer buys from /market → seller withdraws on their profile.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript, WEB, RPC } = require('./wallet.cjs');
const EXE = process.env.CHROME_PATH || undefined; // default: Playwright's bundled Chromium
const SELLER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // #2 creator
const BUYER = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'; // #4
const LEVEL = process.argv[2] || '1';
const shot = (p, n) => p.screenshot({ path: `${__dirname}/shots/${n}.png` }).then(() => console.log('shot', n));
const eth = async (a) => { const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [a, 'latest'] }) }); return Number(BigInt((await r.json()).result) / 10n ** 12n) / 1e6; };

async function session(browser, addr) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript({ content: walletScript(addr) });
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.waitForTimeout(1500);
  return page;
}
async function waitToast(page, re, ms = 30000) {
  await page.getByText(re).first().waitFor({ timeout: ms });
}

(async () => {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  console.log('ETH before: seller', await eth(SELLER), 'buyer', await eth(BUYER));
  // 1. seller lists
  const s = await session(browser, SELLER);
  await s.goto(`${WEB}/level/${LEVEL}`, { waitUntil: 'networkidle' });
  await s.waitForTimeout(1000);
  await shot(s, '20-level-owner');
  await s.getByRole('button', { name: /list for sale/i }).click();
  await s.locator('#list-price').fill('0.5');
  await s.locator('[role=dialog]').getByRole('button', { name: /^list/i }).last().click();
  await waitToast(s, /Listed for 0\.5 ETH/);
  await s.waitForTimeout(1500);
  await shot(s, '21-listed');

  // 2. buyer buys from the market page
  const b = await session(browser, BUYER);
  await b.goto(WEB + '/market', { waitUntil: 'networkidle' });
  await b.waitForTimeout(3000);
  await shot(b, '22-market');
  await b.getByRole('button', { name: /^buy/i }).first().click();
  await b.locator('[role=dialog]').getByRole('button', { name: /buy for/i }).click();
  await waitToast(b, new RegExp(`Level #\\d+ is yours`));
  await b.waitForTimeout(1500);
  await shot(b, '23-bought');

  // 3. seller withdraws on their profile
  await s.goto(`${WEB}/profile/${SELLER}`, { waitUntil: 'networkidle' });
  await s.waitForTimeout(2000);
  await shot(s, '24-profile-before-withdraw');
  await s.getByRole('button', { name: /^withdraw$/i }).click();
  await waitToast(s, /ETH sent to your wallet/);
  await s.waitForTimeout(1500);
  await shot(s, '25-withdrawn');
  console.log('ETH after: seller', await eth(SELLER), 'buyer', await eth(BUYER));
  await browser.close();
})();
