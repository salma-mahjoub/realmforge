#!/usr/bin/env node
// Every feature in a real browser against a fresh local stack (dev:chain + deploy:local + dev:server + dev:web).
// Order matters: season is last because it fast-forwards the local chain clock by a month.
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const step = (label, file, args = [], env = {}) => {
    console.log(`\n▶ ${label}: ${file} ${args.join(' ')}`);
    const t0 = Date.now();
    try {
        // RECORD_DIR set: every page of the scenario is recorded (record.cjs), for scripts/browser-e2e/make-demo-video.mjs
        const rec = process.env.RECORD_DIR ? ['-r', './record.cjs'] : [];
        execFileSync('node', [...rec, file, ...args], { cwd: here, stdio: 'inherit', env: { ...process.env, ...env, RECORD_LABEL: label } });
        results.push([label, 'PASS', Date.now() - t0]);
    } catch {
        results.push([label, 'FAIL', Date.now() - t0]);
        if (process.env.STOP_ON_FAIL) throw new Error(`${label} failed`);
    }
};
step('publish level #1', 'creator.cjs', [], { VARIANT: '0' });
step('play + settle #1', 'player.cjs', ['1']);
step('remix #1 → #2', 'remix.cjs', ['1']);
step('ghost replay on #1', 'ghost.cjs', ['1']);
step('sell + withdraw #1', 'market.cjs', ['1']);
step('1v1 staked race', 'race.cjs', ['1']);
step('SIWE room auth', 'siwe.cjs', ['1']);
step('publish co-op level #3', 'creator.cjs', [], { LEVEL_FILE: 'coop-duo.level.v1.json' });
step('co-op duo on #3', 'coop.cjs', ['3']);
step('season close', 'season.cjs');
console.log('\n── summary ──');
for (const [label, status, ms] of results) console.log(`${status === 'PASS' ? '✔' : '✘'} ${label.padEnd(26)} ${(ms / 1000).toFixed(1)}s`);
const failed = results.filter((r) => r[1] !== 'PASS').length;
console.log(failed ? `\n${failed} scenario(s) failed` : '\n✔ all browser scenarios passed — screenshots in scripts/browser-e2e/shots/');
process.exit(failed ? 1 : 0);
