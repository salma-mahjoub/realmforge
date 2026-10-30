# Asset credits and license record

All shipped artwork and audio is **CC0 1.0 Universal**. No attribution is legally required by these CC0 sources; the credits below are retained for provenance. No Nintendo artwork, audio, characters, names or fonts are included. Kenney fonts and creator branding from the source archives are excluded.

| Pack / work | Author | Original source | Verified license | Files used |
|---|---|---|---|---|
| New Platformer Pack 1.1 | Kenney / Kenney Vleugels | https://kenney.nl/assets/new-platformer-pack | CC0; page and bundled `License.txt` | Selected SVG terrain, blocks, hazards, platforms, enemies, four character colors, items, flags, doors, HUD and backgrounds; `sfx_jump`, `sfx_coin`, `sfx_bump`, `sfx_jump-high`, `sfx_hurt` Oggs. |
| UI Pack 2.0 | Kenney | https://kenney.nl/assets/ui-pack | CC0; page and bundled `License.txt` | Nine Green SVG controls: `button_rectangle_depth_flat`, `button_rectangle_flat`, `button_square_depth_flat`, `icon_checkmark`, `icon_cross`, `arrow_basic_w`, `arrow_basic_e`, `star`, `check_square_color_checkmark`. |
| Interface Sounds | Kenney | https://kenney.nl/assets/interface-sounds | CC0; page and bundled `License.txt` | `Audio/click_001.ogg` → `sfx/ui_click.ogg`. |
| Music Jingles | Kenney | https://kenney.nl/assets/music-jingles | CC0; page and bundled `License.txt` | `Audio/Pizzicato jingles/jingles_PIZZI01.ogg` → `sfx/goal.ogg`. Jingles are used as SFX, not mislabeled as background loops. |
| Overworld Theme | Louswan | https://opengameart.org/content/overworld-theme-0 | CC0; individual work page | `platformer.ogg` → `music/grass_01.ogg`, original untranscoded loop. |
| Pixel Sprinter | Zane Little Music | https://opengameart.org/content/pixel-sprinter | CC0; individual work page | `pixel_sprinter_loop.ogg` → `music/castle_01.ogg`, original untranscoded loop version. |
| Subtle Bass | TinyWorlds | https://opengameart.org/content/subtle-bass | CC0; individual work page | `bassy_tune.ogg` → `music/snow_01.ogg`, original untranscoded loop. |
| RealmForge supplemental art | RealmForge contributors | This repository, `assets/sources/custom/` | CC0; `sources/LICENSE-CC0.txt` | Original ice, slime, seesaw, modular chain bridge, movement arrows/platforms, cannon, two power-up badges, snow/castle background silhouettes and 14 editor tool symbols. |
| RealmForge compositions / derived poses | Kenney originals; RealmForge composition | Original pack above and `assets/scripts/curate.py` | CC0, same as source | Door halves assembled into full doors; keyed lock overlay; fall and skid character poses derived from native jump/duck frames. Run uses the native walk poses at a faster rate. |

Exact upstream filenames and their retained input paths are recorded in [sources/used-files.json](sources/used-files.json). Every output-to-input mapping, including animation frames and derived artwork, is in [sources/recipe.json](sources/recipe.json). Runtime `/assets/manifest.json` also carries source pack IDs and notes. SVG originals used for rasterization remain under `sources/` and are copied beside runtime art in `svg/` subdirectories.

Eight Kenney archives were downloaded and extracted. Three additional packs were evaluated without shipping their content: [Pixel Platformer](https://kenney.nl/assets/pixel-platformer), [Pixel Platformer Blocks](https://kenney.nl/assets/pixel-platformer-blocks), and [Game Icons](https://kenney.nl/assets/game-icons). [Platformer Art Requests](https://kenney.nl/assets/platformer-art-requests) was also evaluated without shipping its content. Each has a CC0 page and bundled license retained in `licenses/`. Game Icons, Interface Sounds and older Music Jingles mirrors on OpenGameArt were downloaded for comparison; their successful hashes are in `sources/oga-packs.json`.

Archived pack-page HTML and license text are in [licenses/](licenses/). Archive SHA-256 digests and sizes are in [sources/packs.json](sources/packs.json); music download digests and individual source pages are in [sources/oga-packs.json](sources/oga-packs.json). Research/download date: 2026-10-30.

## Build software

Build code in `scripts/` is original RealmForge code, licensed MIT (see `LICENSE`). Direct tooling: [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) — MIT (Skia — BSD-3-Clause); [pngjs](https://github.com/pngjs/pngjs) — MIT; [tsx](https://github.com/privatenumber/tsx) — MIT; [TypeScript](https://github.com/microsoft/TypeScript) — Apache-2.0; [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) type definitions — MIT. Platform binding packages preserve their upstream MIT notices in `node_modules` and are pinned by `package-lock.json`. The asset build ships PNG/SVG/JSON/Ogg outputs, with no native renderer code. Sharp/libvips and resvg were evaluated, then removed from the final dependency tree.
