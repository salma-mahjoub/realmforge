#!/usr/bin/env node
// Full demo in a real browser against a running local stack (dev:chain + deploy:local + dev:server + dev:web):
// creator publishes → player plays + settles → NFT sold + royalties withdrawn → 1v1 staked race.
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const step = (file, ...args) => { console.log(`\n▶ ${file} ${args.join(' ')}`); execFileSync('node', [file, ...args], { cwd: here, stdio: 'inherit', env: process.env }); };
step('creator.cjs');
const id = process.env.LEVEL_ID ?? '1';
step('player.cjs', id);
step('market.cjs', id);
step('race.cjs', id);
console.log('\n✔ browser demo done — screenshots in scripts/browser-e2e/shots/');
