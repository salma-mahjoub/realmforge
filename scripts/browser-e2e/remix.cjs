// Browser E2E: a second player remixes a published level. Level page → Remix → editor copy (parentId set),
// publish is blocked until the layout changes, then one tile is added, the copy is cleared and minted as a child
// LevelNFT; both level pages show the lineage. Run creator.cjs first (it publishes the parent).
// Usage: node remix.cjs <parentId>   env: WEB_URL, RPC_URL, PLAYWRIGHT_MODULE, CHROME_PATH
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript } = require('./wallet.cjs');
const EXE = process.env.CHROME_PATH || undefined;
const WEB = process.env.WEB_URL || 'http://localhost:8080';
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const REMIXER = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // Hardhat #3
const PARENT = Number(process.argv[2] || process.env.LEVEL_ID || 1);
const shot = (p, n) => p.screenshot({ path: `${__dirname}/shots/${n}.png` }).then(() => console.log('shot', n));
const fail = (msg) => {
  console.log('FAIL', msg);
  process.exitCode = 1;
};

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
  await page.addInitScript({ content: walletScript(REMIXER, RPC) });

  // ---- level page: Remix button + lineage of the original
  await page.goto(`${WEB}/level/${PARENT}`, { waitUntil: 'networkidle' });
  await page.getByText('Remix lineage').waitFor();
  console.log('PARENT LINEAGE', (await page.locator('.lineage-card').innerText()).replace(/\s+/g, ' '));
  await shot(page, 'r1-parent-page');
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.waitForTimeout(1500);

  await page.getByRole('link', { name: /^remix$/i }).first().click();
  await page.waitForURL(/\/editor/);
  await page.locator('.remix-banner').waitFor({ timeout: 15000 });
  await page.waitForTimeout(2500);
  const banner1 = await page.locator('.remix-banner').innerText();
  console.log('BANNER (copy)', banner1.replace(/\s+/g, ' '));
  if (!/Change something before publishing/.test(banner1)) fail('untouched copy should ask to change something');
  console.log('URL', page.url(), 'NAME', await page.locator('#level-name').inputValue());
  await shot(page, 'r2-editor-copy');

  // publish dialog of the untouched copy: blocked by the remix check
  await page.getByRole('button', { name: /^publish$/i }).first().click();
  const dlg = page.locator('[role=dialog]');
  await dlg.waitFor();
  await page.waitForTimeout(800);
  console.log('REMIX OF FIELD', await dlg.locator('#pub-remix').inputValue());
  console.log('CHECK', (await dlg.locator('.checklist').innerText()).replace(/\s+/g, ' '));
  if (!(await dlg.getByRole('button', { name: /^publish$/i }).isDisabled())) fail('publish should be disabled for an unchanged remix');
  await shot(page, 'r3-publish-blocked');
  await dlg.getByRole('button', { name: /cancel/i }).click();
  await page.waitForTimeout(500);

  // ---- change the layout: place one ground tile high in the sky (place tool + ground are the defaults)
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + 40);
  await page.waitForTimeout(3000); // the scene autosaves (and reports the level to React) every 2 s
  const banner2 = await page.locator('.remix-banner').innerText();
  console.log('BANNER (edited)', banner2.replace(/\s+/g, ' '));
  if (!/Layout changed/.test(banner2)) fail('banner should acknowledge the changed layout');
  await shot(page, 'r4-edited');

  // ---- clear from spawn, then publish the child
  await page.getByRole('button', { name: /test play/i }).first().click();
  await page.waitForTimeout(2000);
  console.log('cleared?', await holdRightUntil(page, /Level cleared in/));
  await page.waitForTimeout(800);
  await shot(page, 'r5-cleared');
  const nudge = page.getByRole('button', { name: /publish now/i });
  if (await nudge.isVisible().catch(() => false)) await nudge.click();
  else {
    const back = page.getByRole('button', { name: /back to edit/i });
    if (await back.isVisible().catch(() => false)) await back.click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: /^publish$/i }).first().click();
  }
  await dlg.waitFor();
  await page.waitForTimeout(1500);
  console.log('CHECK', (await dlg.locator('.checklist').innerText()).replace(/\s+/g, ' '));
  await shot(page, 'r5-publish-ready');
  await dlg.getByRole('button', { name: /^publish$/i }).click();
  let child = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const txt = await dlg.innerText().catch(() => '');
    const m = txt.match(/Minted level #(\d+)/);
    if (m) { child = Number(m[1]); break; }
    if (/error|failed|could not|revert/i.test(txt) && !/Publishing/.test(txt)) { console.log('MODAL TEXT', txt.slice(0, 900)); break; }
    await page.waitForTimeout(500);
  }
  console.log('MINTED CHILD', child);
  await shot(page, 'r6-published');
  if (!child) {
    fail('child not minted');
    await browser.close();
    return;
  }

  // ---- lineage on both pages (indexer needs a moment)
  for (const [id, expect] of [[child, `#${PARENT}`], [PARENT, `#${child}`]]) {
    let txt = '';
    for (let i = 0; i < 12; i++) {
      await page.goto(`${WEB}/level/${id}`, { waitUntil: 'networkidle' });
      await page.getByText('Remix lineage').waitFor();
      await page.waitForTimeout(500);
      txt = (await page.locator('.lineage-card').innerText()).replace(/\s+/g, ' ');
      if (txt.includes(expect)) break;
      await page.waitForTimeout(1000);
    }
    console.log(`LINEAGE #${id}`, txt);
    if (!txt.includes(expect)) fail(`lineage of #${id} should mention ${expect}`);
    await shot(page, `r7-lineage-${id}`);
  }
  await browser.close();
  console.log(process.exitCode ? 'REMIX E2E FAILED' : 'REMIX E2E OK');
})();
