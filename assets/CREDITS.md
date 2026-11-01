# Asset credits and license record

The Kenney fallback in `web/public/assets/` contains **CC0 1.0 Universal** artwork and audio. No attribution is legally required by these CC0 sources; the credits below are retained for provenance. This fallback contains no Nintendo art. Kenney fonts and creator branding from the source archives are excluded. The separate private-demo Mario pack is Nintendo property, documented in [packs/mario/SOURCES.md](packs/mario/SOURCES.md); team authorization for a private educational demo does not grant a Nintendo licence.

| Pack / work | Author | Original source | Verified license | Files used |
|---|---|---|---|---|
| New Platformer Pack 1.1 | Kenney / Kenney Vleugels | https://kenney.nl/assets/new-platformer-pack | CC0; page and bundled `License.txt` | Selected SVG terrain, blocks, hazards, platforms, enemies, four character colors, items, flags, doors, HUD and backgrounds; `sfx_jump`, `sfx_coin`, `sfx_bump`, `sfx_jump-high`, `sfx_hurt` Oggs. |
| Red mushroom (New Platformer Pack 1.1) | Kenney / Kenney Vleugels | https://kenney.nl/assets/new-platformer-pack | Official page's Creative Commons CC0 field; exact bundled [License.txt](sources/custom/kenney-mushroom/License.txt) declares Creative Commons Zero, CC0 | Archive member `Vector/Tiles/mushroom_red.svg`, unchanged in [sources/custom/kenney-mushroom/mushroom_red.svg](sources/custom/kenney-mushroom/mushroom_red.svg). Trimmed vector raster → `items/mushroom.png` and `icons/editor/palette_mushroom.png` (128×128), unchanged SVG companions in both `svg/` directories. Static art, not an invented animation. |
| UI Pack 2.0 | Kenney | https://kenney.nl/assets/ui-pack | CC0; page and bundled `License.txt` | Nine Green SVG controls: `button_rectangle_depth_flat`, `button_rectangle_flat`, `button_square_depth_flat`, `icon_checkmark`, `icon_cross`, `arrow_basic_w`, `arrow_basic_e`, `star`, `check_square_color_checkmark`. |
| Interface Sounds | Kenney | https://kenney.nl/assets/interface-sounds | CC0; page and bundled `License.txt` | `Audio/click_001.ogg` → `sfx/ui_click.ogg`. |
| Music Jingles | Kenney | https://kenney.nl/assets/music-jingles | CC0; page and bundled `License.txt` | `Audio/Pizzicato jingles/jingles_PIZZI01.ogg` → `sfx/goal.ogg`. Jingles are used as SFX, not mislabeled as background loops. |
| Overworld Theme | Louswan | https://opengameart.org/content/overworld-theme-0 | CC0; individual work page | `platformer.ogg` → `music/grass_01.ogg`, original untranscoded loop. |
| Pixel Sprinter | Zane Little Music | https://opengameart.org/content/pixel-sprinter | CC0; individual work page | `pixel_sprinter_loop.ogg` → `music/castle_01.ogg`, original untranscoded loop version. |
| Subtle Bass | TinyWorlds | https://opengameart.org/content/subtle-bass | CC0; individual work page | `bassy_tune.ogg` → `music/snow_01.ogg`, original untranscoded loop. |
| RealmForge supplemental art | RealmForge contributors | This repository, `assets/sources/custom/` | CC0; `sources/LICENSE-CC0.txt` | Original ice, slime, seesaw, modular chain bridge, movement arrows/platforms, cannon, two power-up badges, snow/castle background silhouettes and 14 editor tool symbols. |
| RealmForge compositions / derived poses | Kenney originals; RealmForge composition | Original pack above and `assets/scripts/curate.py` | CC0, same as source | Door halves assembled into full doors; keyed lock overlay; fall and skid character poses derived from native jump/duck frames. Run uses the native walk poses at a faster rate. |

Legacy upstream filenames and their retained input paths are recorded in [sources/used-files.json](sources/used-files.json). Legacy output-to-input mappings, including animation frames and derived artwork, are in [sources/recipe.json](sources/recipe.json). The mushroom's additional build recipe, original archive member names, direct download URL, creator, licence evidence and SHA-256 values for the archive, SVG and bundled licence are in [sources/custom/kenney-mushroom/source.json](sources/custom/kenney-mushroom/source.json), verified on 2026-10-31 against the existing downloaded archive and official pack page. Its location under `custom/` is an ownership boundary; it is fetched Kenney artwork, not a RealmForge drawing. Runtime `/assets/manifest.json` also carries source pack IDs and notes. SVG originals used for rasterization remain under `sources/` and are copied beside runtime art in `svg/` subdirectories.

Eight Kenney archives were downloaded and extracted. Three additional packs were evaluated without shipping their content: [Pixel Platformer](https://kenney.nl/assets/pixel-platformer), [Pixel Platformer Blocks](https://kenney.nl/assets/pixel-platformer-blocks), and [Game Icons](https://kenney.nl/assets/game-icons). [Platformer Art Requests](https://kenney.nl/assets/platformer-art-requests) was also evaluated without shipping its content. Each has a CC0 page and bundled license retained in `licenses/`. Game Icons, Interface Sounds and older Music Jingles mirrors on OpenGameArt were downloaded for comparison; their successful hashes are in `sources/oga-packs.json`.

Archived pack-page HTML and license text are in [licenses/](licenses/). Archive SHA-256 digests and sizes are in [sources/packs.json](sources/packs.json); music download digests and individual source pages are in [sources/oga-packs.json](sources/oga-packs.json). Research/download date: 2026-10-30.

## Build software

Build code in `scripts/` is original RealmForge code, licensed MIT (see `LICENSE`). Direct tooling: [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) — MIT (Skia — BSD-3-Clause); [pngjs](https://github.com/pngjs/pngjs) — MIT; [tsx](https://github.com/privatenumber/tsx) — MIT; [TypeScript](https://github.com/microsoft/TypeScript) — Apache-2.0; [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) type definitions — MIT. Platform binding packages preserve their upstream MIT notices in `node_modules` and are pinned by `package-lock.json`. The asset build ships PNG/SVG/JSON/Ogg outputs, with no native renderer code. Sharp/libvips and resvg were evaluated, then removed from the final dependency tree.

## Downloaded Nintendo imports — private educational demo only (1 November 2026)

Nintendo owns the imagery, models and textures below; ripped by **DogToon64**.
The source sheets/archive READMEs require Nintendo credit and request optional
ripper credit, retained here. These are not CC0 and are never public-safe assets.

| Source | Retained output and use |
|---|---|
| [Super Mario Maker 2, NSMBU Goomba, TSR 238649](https://www.spriters-resource.com/nintendo_switch/supermariomaker2/asset/238649/) | `packs/mario/goomba-import/source/goomba-tsr-238649.png`, SHA-256 `ba3f122c226d4ece1cfef057dc7b32d99c5eaf456d5cb7f0c3f6c7f8429f567b`. Native crops supply 16 walk and 14 already-flattened stomp frames in the gameplay atlas. Authored 12/24 fps, not original timing; unlabelled groups B/C stay inspection-only. |
| [NSMBU Mario, Models Resource 332841](https://models.spriters-resource.com/wii_u/newsupermariobrosu/asset/332841/) and [Luigi 329038](https://models.spriters-resource.com/wii_u/newsupermariobrosu/asset/329038/) | Original models/textures and 18 bind-pose orthographic PNGs in `packs/mario/character-model-import/` and `web/public/packs/mario/characters/model-preview/`. Inspection evidence only; no animation manifest or gameplay use. All 24 DAE files contain zero original clips/channels. Original compatible timed clips remain required. |

The Goomba walk envelope is 85×100 opaque pixels, smaller than the previous
104×122 served still. The common 120×100 canvas displays at 76.8×64 (uniform
0.64 scale) with bottom-center feet; the wider flattened stomp uses the same
canvas without extra squash. Recipes, exact hashes and verification are in
[goomba-import/INTEGRATION.md](packs/mario/goomba-import/INTEGRATION.md) and
[character-model-import/MODEL_REPORT.md](packs/mario/character-model-import/MODEL_REPORT.md).
Model preview tooling licences are recorded in that import's CREDITS.md; no
runtime dependency was added by this integration.
