// Browser E2E: creator connects wallet, imports a level, clears it in test play, publishes it as an NFT.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript } = require('./wallet.cjs');
const EXE = process.env.CHROME_PATH || undefined; // default: Playwright's bundled Chromium
const CREATOR = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'; // Hardhat #2
const shot = (p, n) => p.screenshot({ path: `${__dirname}/shots/${n}.png` }).then(() => console.log('shot', n));

async function connect(page) {
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.waitForTimeout(800);
  await shot(page, '00-connect-modal');
  console.log('MODAL', (await page.locator('[role=dialog]').innerText().catch(() => '')).slice(0, 400));
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.waitForFunction(() => (window.__walletLog || []).includes('eth_requestAccounts'), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
}

async function holdRightUntil(page, doneText, ms = 15000) {
  await page.locator('canvas').first().click({ position: { x: 50, y: 50 } }).catch(() => {});
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('Shift');
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < ms) {
      if (await page.getByText(doneText).first().isVisible().catch(() => false)) return true;
      await page.waitForTimeout(200);
    }
    return false;
  } finally {
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('Shift');
  }
}

(async () => {
  require('fs').mkdirSync(`${__dirname}/shots`, { recursive: true });
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript({ content: walletScript(CREATOR) });
  await page.goto('http://localhost:8080/editor', { waitUntil: 'networkidle' });
  await connect(page);
  await shot(page, '01-connected');

  const lvl = JSON.parse(require('fs').readFileSync(`${__dirname}/demo-sprint.level.v1.json`, 'utf8'));
  const n = Number(process.env.VARIANT ?? Date.now() % 6);
  lvl.entities[1].x = 9 + n; lvl.meta.name = n ? `Demo Sprint ${n + 1}` : 'Demo Sprint';
  require('fs').writeFileSync(`${__dirname}/variant.level.v1.json`, JSON.stringify(lvl));
  await page.locator('input[type=file]').setInputFiles(`${__dirname}/variant.level.v1.json`);
  await page.waitForTimeout(1500);
  await shot(page, '02-imported');

  await page.getByRole('button', { name: /test play/i }).first().click();
  await page.waitForTimeout(2000);
  const cleared = await holdRightUntil(page, /clear|goal|finished|well done/i);
  console.log('cleared?', cleared);
  await page.waitForTimeout(800);
  await shot(page, '03-cleared');
  // ---- publish
  await page.getByRole('button', { name: /^publish$/i }).first().click();
  const dlg = page.locator('[role=dialog]');
  await dlg.waitFor();
  await page.waitForTimeout(1500);
  await shot(page, '04-publish-modal');
  await dlg.getByRole('button', { name: /^publish$/i }).click();
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const txt = await dlg.innerText().catch(() => '');
    const m = txt.match(/Minted level #(\d+)/);
    if (m) { console.log('MINTED', m[1]); break; }
    if (/error|failed|could not/i.test(txt) && !/Publishing/.test(txt)) { console.log('MODAL TEXT', txt.slice(0, 900)); break; }
    await page.waitForTimeout(500);
  }
  await shot(page, '05-published');
  console.log('walletLog', (await page.evaluate(() => window.__walletLog)).filter((m) => !/^eth_(chainId|accounts|blockNumber|getBlockByNumber|call|getTransactionReceipt|estimateGas|getTransactionByHash|gasPrice|maxPriorityFeePerGas|feeHistory|getTransactionCount|getBalance)$/.test(m)));
  await browser.close();
})();
