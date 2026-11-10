// Browser E2E, 2-player co-op: host creates a room (no stake), guest joins by code, both ready, the host reaches the
// checkpoint, the guest falls into the pit behind the spawn and must respawn AT THAT CHECKPOINT (shared), both reach
// the flag, team result with the combined time, host claims the co-op reward on-chain.
// Level: publish coop-duo.level.v1.json first (LEVEL_FILE=coop-duo.level.v1.json node creator.cjs).
// Env: WEB_URL (default http://localhost:8080), RPC_URL (default http://127.0.0.1:8545); argv[2] = level id.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { walletScript } = require('./wallet.cjs');
const EXE = process.env.CHROME_PATH || undefined;
const WEB = process.env.WEB_URL || 'http://localhost:8080';
const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const HOST = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'; // #3 (has FORGE)
const GUEST = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'; // #5
const LEVEL = process.argv[2] || '1';
const CHECKPOINT_X = 14; // coop-duo.level.v1.json
require('fs').mkdirSync(`${__dirname}/shots`, { recursive: true });
const shot = (p, n) => p.screenshot({ path: `${__dirname}/shots/${n}.png` }).then(() => console.log('shot', n));
const fail = (msg) => { console.log('FAIL', msg); process.exitCode = 1; };

async function session(browser, addr, path) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const tag = addr === HOST ? 'host ' : 'guest';
  page.on('pageerror', (e) => console.log(tag, 'PAGEERROR', e.message));
  page.on('console', (m) => (m.type() === 'error' && !/Failed to load resource|Reown|Lit is|walletconnect/i.test(m.text())) && console.log(tag, m.type(), m.text().slice(0, 240)));
  await page.addInitScript({ content: walletScript(addr, RPC) });
  await page.goto(WEB + path, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /connect wallet/i }).first().click();
  await page.getByText('RealmForge Test Wallet').first().click();
  await page.waitForTimeout(1500);
  return page;
}
const focus = (page) => page.locator('canvas').first().click({ position: { x: 20, y: 20 } }).catch(() => {});
const pos = (page) => page.evaluate(() => { const s = window.__play; return s ? { ...s.sample(), spawn: s.spawnTile, key: s.scene.key } : null; });
const serverView = (page) => page.evaluate(() => {
  const r = window.__coopRoom; const out = { shared: r?.state?.sharedCheckpoint, phase: r?.state?.phase, players: [] };
  r?.state?.players?.forEach((p) => out.players.push({ a: p.address.slice(0, 6), x: +p.x.toFixed(2), f: p.frame, cp: p.checkpoint, strikes: p.strikes, finished: p.finished, t: p.finishTimeMs }));
  return out;
});
async function holdUntil(page, keys, until, ms) {
  await focus(page);
  for (const k of keys) await page.keyboard.down(k);
  const t0 = Date.now();
  try {
    while (Date.now() - t0 < ms) { if (await until()) return true; await page.waitForTimeout(100); }
    return false;
  } finally { for (const k of keys) await page.keyboard.up(k); }
}

const T0 = Date.now(); const _log = console.log; console.log = (...a) => _log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
(async () => {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
  const host = await session(browser, HOST, '/coop/new');
  const faucet = host.getByRole('button', { name: /get 100 forge/i });
  if (await faucet.isVisible().catch(() => false)) { await faucet.click(); await host.getByText(/100 FORGE/).first().waitFor(); await host.waitForTimeout(3000); }
  await host.locator('#coop-level').selectOption(LEVEL).catch((e) => console.log('select', e.message));
  await shot(host, '40-coop-create');
  await host.getByRole('button', { name: /create co-op room/i }).click();
  await host.waitForURL(/\/coop\/(?!new)[A-Z0-9]+/, { timeout: 30000 });
  const code = host.url().split('/coop/')[1];
  console.log('room', code);

  const guest = await session(browser, GUEST, '/coop/new');
  await guest.getByLabel('Room code').fill(code);
  await guest.getByRole('button', { name: /join team/i }).click();
  await guest.waitForURL(new RegExp(`/coop/${code}$`));
  await guest.getByRole('button', { name: /i.m ready/i }).waitFor({ timeout: 30000 });
  await host.waitForTimeout(2500);
  await shot(host, '41-coop-lobby-host');
  await host.getByRole('button', { name: /i.m ready/i }).click();
  await guest.getByRole('button', { name: /i.m ready/i }).click();
  await host.waitForTimeout(1200);
  await shot(host, '42-coop-countdown');
  await host.getByRole('button', { name: /run in progress/i }).waitFor({ timeout: 20000 });
  await guest.getByRole('button', { name: /run in progress/i }).waitFor({ timeout: 20000 });
  await host.waitForTimeout(500);
  console.log('after GO', await serverView(host));

  // 1. the host sprints to the checkpoint: the room shares it with the whole team
  const reached = await holdUntil(host, ['ArrowRight'], async () => (await serverView(host)).shared >= 0, 8000);
  console.log('host reached checkpoint?', reached, await serverView(host));
  if (!reached) fail('shared checkpoint never set');
  await guest.getByText(/Team checkpoint 1 \/ 1/).waitFor({ timeout: 5000 }).catch(() => fail('guest UI does not show the team checkpoint'));
  await shot(host, '43-coop-host-checkpoint');
  await shot(guest, '44-coop-guest-sees-partner');

  // 2. the guest walks left into the pit, dies and must reappear at the shared checkpoint (not at spawn)
  const before = await pos(guest);
  console.log('guest before fall', before);
  await holdUntil(guest, ['ArrowLeft'], async () => { const p = await pos(guest); return p && p.spawn && p.spawn.x === CHECKPOINT_X; }, 8000);
  await guest.waitForTimeout(800);
  const after = await pos(guest);
  console.log('guest after respawn', after);
  if (!after || Math.abs(after.x - CHECKPOINT_X) > 1.5) fail(`guest respawned at x=${after?.x}, expected the checkpoint x=${CHECKPOINT_X}`);
  await shot(guest, '45-coop-guest-respawned-at-checkpoint');
  await guest.waitForTimeout(600);
  console.log('server after respawn', await serverView(guest));

  // 3. both run to the flag; the team clears when the last one arrives
  const done = (p) => async () => /Team clear!|did not clear/.test(await p.locator('main').innerText().catch(() => ''));
  await Promise.all([
    holdUntil(host, ['ArrowRight'], async () => (await serverView(host)).players.find((p) => p.a === HOST.slice(0, 6))?.finished, 15000),
    (async () => { await guest.waitForTimeout(1200); await holdUntil(guest, ['ArrowRight'], async () => (await serverView(guest)).players.find((p) => p.a === GUEST.slice(0, 6))?.finished, 15000); })(),
    (async () => { await host.waitForTimeout(1500); await shot(host, '46-coop-host-waiting-at-flag'); })(),
  ]);
  const cleared = await holdUntil(host, [], done(host), 15000);
  console.log('team result shown?', cleared, await serverView(host));
  await host.waitForTimeout(800);
  await shot(host, '47-coop-team-result-host');
  await shot(guest, '48-coop-team-result-guest');
  const resultText = await host.locator('[aria-label="Team result"]').innerText().catch(() => '');
  console.log('RESULT\n' + resultText);
  if (!/Team clear!/.test(resultText)) fail('no team clear');
  const strikes = (await serverView(host)).players.map((p) => p.strikes);
  if (strikes.some((s) => s > 0)) fail(`server strikes: ${strikes}`);

  // 4. the host claims its signed co-op RunResult on-chain
  await host.getByRole('button', { name: /claim reward on-chain/i }).click();
  await host.getByRole('button', { name: /reward claimed/i }).waitFor({ timeout: 60000 }).then(() => console.log('claimed')).catch(() => fail('claim did not confirm'));
  await host.waitForTimeout(1000);
  await shot(host, '49-coop-claimed');
  await browser.close();
  console.log(process.exitCode ? 'CO-OP E2E FAILED' : 'CO-OP E2E OK');
})();
