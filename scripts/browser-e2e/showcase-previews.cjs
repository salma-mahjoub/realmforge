// Render web/public/ui/showcase/<id>.jpg previews: open each "Made by us" level in the editor and grab the canvas.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const WEB = process.env.WEB_URL || 'http://localhost:8080';
const OUT = path.resolve(__dirname, '../../web/public/ui/showcase');
const IDS = ['demo-sprint', 'seesaw-lab', 'seesaw-hell', 'duo-checkpoint', 'staircase', 'castle-gauntlet'];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('dialog', (d) => d.accept());
  for (const [i, id] of IDS.entries()) {
    await page.goto(WEB + '/', { waitUntil: 'networkidle' });
    const card = page.locator('.showcase-card').nth(i);
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('button', { name: /remix in editor/i }).click();
    await page.waitForURL(/\/editor/);
    await page.locator('canvas').first().waitFor();
    await page.waitForTimeout(2500);
    const png = path.join(OUT, `${id}.png`);
    await page.locator('canvas').first().screenshot({ path: png });
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-vf', 'scale=640:360:force_original_aspect_ratio=increase,crop=640:360', '-q:v', '4', path.join(OUT, `${id}.jpg`)]);
    fs.unlinkSync(png);
    console.log('preview', id);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
