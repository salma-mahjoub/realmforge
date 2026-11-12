// Regenerates the UI artwork of the web app from the bundled CC0 asset pack:
//   web/public/ui/hero/<theme>.webp         1920×445 banner of the home page
//   web/public/ui/thumbs/<theme>-<n>.webp   640×360 level-card thumbnails, plus @2x (1280×720)
//   web/public/ui/showcase/<id>.jpg         640×360 previews of the bundled "Made by us" levels
// Every image is a real render of the game: each level is opened in the editor and the Phaser canvas is captured.
//
// Needs: the dev server running (`cd web && npm run dev`), Playwright, Google Chrome, `cwebp` and `sips` (macOS).
//   WEB_URL=http://localhost:8080 CHROME_PATH=/path/to/chrome PLAYWRIGHT_MODULE=playwright node scripts/capture-ui-art.cjs
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const WEB = process.env.WEB_URL || 'http://localhost:8080';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UI = path.resolve(__dirname, '../web/public/ui');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rf-art-'));

// Showcase cards in the order of web/src/game/level/showcase.ts.
const SHOWCASE = ['demo-sprint', 'seesaw-lab', 'seesaw-hell', 'duo-checkpoint', 'staircase', 'castle-gauntlet'];
// Level used as the base of each theme render (the desert has no bundled level: a grass one is re-themed).
const THEME_BASE = { grass: 0, snow: 1, castle: 5, desert: 4 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });

async function openShowcaseInEditor(page, index) {
  await page.goto(WEB + '/', { waitUntil: 'networkidle' });
  const card = page.locator('.showcase-card').nth(index);
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: /remix in editor/i }).click();
  await page.waitForURL(/\/editor/);
  await page.locator('canvas').first().waitFor();
  await sleep(2500);
}

/** Test-play (key T) shows the level as players see it: parallax background, no grid, no editor chrome. */
async function startTestPlay(page) {
  await page.addStyleTag({ content: '.toaster, .mode-badge { display: none !important; }' });
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('t');
  await sleep(2500);
}

async function grabCanvas(page, file) {
  await page.locator('canvas').first().screenshot({ path: file });
}

/** Crop (x, y, w, h) of a PNG and scale it to w×h as WebP. */
function webp(src, dest, crop, size) {
  run('cwebp', ['-quiet', '-q', '82', '-crop', ...crop.map(String), '-resize', ...size.map(String), src, '-o', dest]);
}

(async () => {
  for (const dir of ['hero', 'thumbs', 'showcase']) fs.mkdirSync(path.join(UI, dir), { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 2200, height: 1300 } });
  page.on('dialog', (d) => d.accept());

  for (const [i, id] of SHOWCASE.entries()) {
    await openShowcaseInEditor(page, i);
    await startTestPlay(page);
    const png = path.join(TMP, `${id}.png`);
    await grabCanvas(page, png);
    run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '--resampleHeight', '360', png, '--out', path.join(UI, 'showcase', `${id}.jpg`)]);
    console.log('showcase', id);
  }

  for (const [theme, index] of Object.entries(THEME_BASE)) {
    await openShowcaseInEditor(page, index);
    if (theme === 'desert') {
      await page.getByLabel('Theme').selectOption(theme);
      await sleep(2000);
    }
    await startTestPlay(page);
    const png = path.join(TMP, `theme-${theme}.png`);
    await grabCanvas(page, png);
    const { width: W, height: H } = readSize(png);

    // Hero: a wide band down to the ground line.
    const bandH = Math.round(W * 445 / 1920);
    webp(png, path.join(UI, 'hero', `${theme}.webp`), [0, Math.max(0, H - bandH), W, Math.min(bandH, H)], [1920, 445]);

    // Thumbnails: four 16:9 framings of the same render.
    const boxH = (zoom) => Math.round(Math.min(H, (W * 9) / 16) * zoom);
    const framings = [[1, 0, 0], [0.78, 0, 0.22], [0.78, 1, 0.22], [0.62, 0.5, 0.3]];
    framings.forEach(([zoom, anchorX, anchorY], n) => {
      const h = boxH(zoom), w = Math.round((h * 16) / 9);
      const x = Math.round((W - w) * anchorX), y = Math.round((H - h) * anchorY);
      webp(png, path.join(UI, 'thumbs', `${theme}-${n}.webp`), [x, y, w, h], [640, 360]);
      webp(png, path.join(UI, 'thumbs', `${theme}-${n}@2x.webp`), [x, y, w, h], [1280, 720]);
    });
    console.log('theme', theme, `${W}x${H}`);
  }

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });

/** PNG header: width and height are the first two 32-bit integers of the IHDR chunk. */
function readSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
