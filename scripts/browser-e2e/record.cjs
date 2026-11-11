// Preload (node -r ./record.cjs <scenario>.cjs): record every page the scenario opens as a Playwright video.
// Env: RECORD_DIR (output dir), RECORD_LABEL (scenario name). Appends one line per page to RECORD_DIR/manifest.jsonl:
// { label, index, path, startedAt } so the videos can be cut together in order afterwards.
const fs = require('fs');
const path = require('path');
const DIR = process.env.RECORD_DIR;
if (DIR) {
  const pw = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const label = process.env.RECORD_LABEL || path.basename(process.argv[1] || 'scenario', '.cjs');
  const outDir = path.join(DIR, label.replace(/[^\w.-]+/g, '_'));
  fs.mkdirSync(outDir, { recursive: true });
  let index = 0;
  const size = { width: 1440, height: 900 };
  const track = async (page) => {
    const i = index++;
    const startedAt = Date.now();
    const p = await page.video()?.path();
    if (p) fs.appendFileSync(path.join(DIR, 'manifest.jsonl'), JSON.stringify({ label, index: i, path: p, startedAt }) + '\n');
  };
  const launch = pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch = async (opts) => {
    const browser = await launch(opts);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (o = {}) => {
      const ctx = await newContext({ ...o, recordVideo: { dir: outDir, size } });
      ctx.on('page', (pg) => void track(pg));
      return ctx;
    };
    browser.newPage = async (o = {}) => {
      const ctx = await browser.newContext(o);
      const page = await ctx.newPage();
      // closing the page's own context flushes its video
      page.on('close', () => void ctx.close().catch(() => {}));
      return page;
    };
    const close = browser.close.bind(browser);
    browser.close = async () => {
      // close contexts first so every video is finalised before the browser exits
      await Promise.all(browser.contexts().map((c) => c.close().catch(() => {})));
      return close();
    };
    return browser;
  };
}
