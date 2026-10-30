# Movement research

Research date: 2026-10-30. Numeric mechanics only; no Nintendo code, sprites, sounds, ROM data, or disassemblies are included.

## Original SMB reference

[Jdaster64, A Complete Guide to SMB's Physics Engine (archived author chart)](https://web.archive.org/web/20130807122227/http://i276.photobucket.com/albums/kk21/jdaster64/smb_playerphysics.png) is the widely circulated visual reference. Its [source index and chart transcription](https://frameadvance.net/sources/jdaster64-smb-physics/) identifies the author and archive. The original image host was inaccessible during this research; the numeric jump rows were cross-checked against SMBpedia below.

At 16 reference pixels per tile, walk/run limits are 1.5/2.5 px/frame. Takeoff speed selects five rows, separated at 0.5625, 1, 1.5625, 1.75 px/frame:

| Row | Launch vy | Held rising gravity | Released/falling gravity |
|---|---:|---:|---:|
| 0 | -4 | 0.125 | 0.4375 |
| 1 | -4 | 0.125 | 0.4375 |
| 2 | -4 | 0.1171875 | 0.375 |
| 3 | -5 | 0.15625 | 0.5625 |
| 4 | -5 | 0.15625 | 0.5625 |

The intended fall cap is 4 px/frame; original fractional-clamp quirks can exceed it. This package uses a strict cap. Positive Y points down. This table describes mechanics, not copied implementation.

[Slither's original movement investigation, SMBpedia](https://simplistic6502.github.io/smb1_tll/smbpedia_movement.html) distinguishes horizontal speed (1/16 px) from a finer acceleration accumulator. Ground walk/run increments convert to 152/4096 and 228/4096 px/frame²; slowing uses 208/4096, doubled when facing against motion. Air acceleration depends on speed and facing; releasing direction preserves momentum. Running eligibility has a ten-frame timer. Jump release permanently selects heavier gravity for that arc. The engine treats horizontal subspeed differently from vertical fractions.

Our independently written approximation rounds increments to 1/256 px and integrates continuous fixed-point horizontal positions: walk 10/256, run 14/256, release 13/256, skid 26/256; air forward 10/256 and reverse 19/256. It retains the takeoff speed cap and has no passive air drag. It deliberately omits original overflow, simultaneous-direction exploits, running timer, fractional position quirks, and minimum-rise release delay.

[TASVideos' SMB resource](https://tasvideos.org/GameResources/NES/SuperMarioBros) documents backward-jump fast acceleration, simultaneous-direction braking, and the original wall-jump collision exploit. Those exploits are not reproduced. Its wall jump requires particular block alignment, unlike modern intentional wall kicks.

## Modern extensions and evidence limits

[Nintendo's own SMM2 building guide](https://play.nintendo.com/news-tips/tips-tricks/super-mario-maker-2-tips-tricks/) establishes that moves depend on game style and discusses wall climbing and conveyors. It does not supply numerical wall-kick or forgiveness timings. No verified primary numerical SMM2 coyote-time measurement was found. We do **not** claim six-frame coyote time or buffering is an exact SMM2 mechanic.

RealmForge design choices: six airborne frames of coyote eligibility; a six-frame buffer including the press frame; wall slide capped at 1 px/frame while pressing toward a wall; wall kick (±2.5, -4.5) with eight frames of steering lock; verified head clearance nudges up to four reference pixels. Stomps launch at -3 or -5 depending on jump hold; springs default to -7. Ice uses quarter acceleration and one-fifth friction; slime halves speed and triples friction. Crouching disables acceleration but retains decaying momentum; the collision hull remains standing size.

## Determinism and licensing

All package physics and lab graphics are original. Research pages are references only, not vendored code; their licenses grant no assumed reuse rights. Phaser and its bundled Matter engine are MIT; TypeScript is Apache-2.0, Vite and Vitest MIT. See `SOURCES.md` for upstream license links. Fixed-point simulation is deterministic for identical initial state, inputs, tuning, and trusted contact/surface sequence. Matter remains a floating-point collision solver; it is not promised bit-identical across environments. Replay validation requires a server-owned collision solver and matching level version.
