# Verification

2026-10-30; Node v22.23.2, npm 10.9.8. Commands run from game-core, except the lab build from game-core/lab.

## npm test

Exit 0.

```text
> @realmforge/game-core@0.1.0 test
> vitest run


 RUN  v3.2.7 ~/realmforge/game-core

 ✓ test/controller.test.ts (21 tests) 13ms

 Test Files  1 passed (1)
      Tests  21 passed (21)
   Start at  20:09:19
   Duration  319ms (transform 65ms, setup 0ms, collect 90ms, tests 13ms, environment 0ms, prepare 38ms)
```

## npm run build; npm run typecheck:lab; headless ESM import

Exit 0.

```text
> @realmforge/game-core@0.1.0 build
> tsc -p tsconfig.json


> @realmforge/game-core@0.1.0 typecheck:lab
> tsc -p lab/tsconfig.json

Headless import: 1
```

## npx vite build (lab/)

Exit 0.

```text
vite v7.3.7 building client environment for production...
transforming...
✓ 14 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                    0.60 kB │ gzip:   0.43 kB
dist/assets/index-BMf9mHd3.js  1,217.14 kB │ gzip: 336.26 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 2.24s
```

## Browser checks

Playwright with installed Chromium: arrow-key walking, Space jump, platform landing, spring launch, wall slide and wall kick all passed assertions. Compound body has six parts, infinite inertia and ignoreGravity=true. Browser console reported zero errors/warnings after page reload. Screenshot: output/playwright/lab.png (local, ignored).

## Integration limits

Matter uses floating point. Authoritative server validation needs a trusted collision resolver and matching level identity; replay input alone does not prove a valid clear. Crouch retains the standing hull. One-way filtering and gameplay entity responses belong to the host. Vite's only build warning is the large Phaser bundle shown above.

`npm ci --dry-run --ignore-scripts --no-audit --no-fund` also passed from game-core under npm 10.9.8. The lockfile has two ISC toolchain transitives outside the requested license allowlist; see SOURCES.md. Runtime dependency Phaser is MIT.

