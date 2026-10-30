# Sources and licenses

Original controller, tests and colored lab rectangles: authored for RealmForge; MIT (see LICENSE). No external art or Nintendo implementation is used.

| Dependency | License | Upstream |
|---|---|---|
| Phaser 3.90 (includes Matter.js) | MIT | https://github.com/phaserjs/phaser/blob/v3.90.0/license.txt |
| Matter.js | MIT | https://github.com/liabru/matter-js/blob/master/LICENSE |
| TypeScript | Apache-2.0 | https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt |
| Vite | MIT | https://github.com/vitejs/vite/blob/main/LICENSE |
| Vitest | MIT | https://github.com/vitest-dev/vitest/blob/main/LICENSE.md |

The package lock records transitive versions; installed packages retain their upstream license notices. Numeric research citations and intentional differences are in docs/MOVEMENT_RESEARCH.md; no reference implementation was copied.

## Toolchain license exception to resolve

The lockfile audit found two **ISC** transitive development dependencies: `picocolors@1.1.1` (Vite/PostCSS) and `siginfo@2.0.0` (Vitest's diagnostic helper). ISC is permissive, but it is outside the requested MIT/Apache/CC0/BSD allowlist. No ISC source was copied into the controller or lab; these are build/test tools in ignored node_modules. This remains an explicit license-policy issue if the allowlist also applies to development-tool transitives. Sources: https://github.com/alexeyraspopov/picocolors/blob/main/LICENSE and https://github.com/emilbayes/siginfo/blob/master/LICENSE .
