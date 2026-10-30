# Research and coverage

Evaluated on 2026-10-30 against `docs/SPEC.md` §3.2. License checks used each creator's actual pack page plus the bundled license when present; OpenGameArt's individual work license field was checked, rather than assuming a collection's license applies to its members.

## Selection

| Source | License verified | Decision |
|---|---|---|
| Kenney New Platformer Pack 1.1 | CC0 page + bundled license | Main visual language. Named SVG originals, native 64px tiles, 128px character art, five character colors, four requested terrains, enemy poses, mechanisms, HUD and short Ogg effects. Four character colors retained. |
| Kenney UI Pack 2.0 | CC0 page + bundled license | Nine green vector controls retained; other colors, fonts and most variants omitted. |
| Kenney Interface Sounds | CC0 page + bundled license | One menu click retained. Gameplay effects instead use the more suitable platformer pack sounds. |
| Kenney Music Jingles | CC0 page + bundled license | One completion cue retained. Short jingles are not appropriate level music loops. |
| Kenney Game Icons | CC0 page + bundled license | Downloaded/evaluated; originals are whole vector sheets with generic controls. The final editor uses dedicated original tool SVGs and exact element thumbnails instead. |
| Kenney Pixel Platformer 1.2 | CC0 page + bundled license | Downloaded/evaluated. 18px pixel art looks inconsistent beside the selected vector art; no pixels shipped. |
| Kenney Pixel Platformer Blocks | CC0 page + bundled license | Downloaded/evaluated. Useful pixel alternative; omitted to keep one coherent style. |
| Kenney Platformer Art Requests | CC0 page + bundled license | Downloaded/evaluated for missing mechanisms; native New Platformer SVGs and small original supplements fit better than the older 70px style. |
| OpenGameArt Platformer Art Complete Pack | CC0 individual page | Evaluated as fallback while Kenney's download endpoint failed. Transfer timed out; not used. |
| OpenGameArt 5 Chiptunes (Action), SubspaceAudio | CC0 individual page | Evaluated as a loop source; 49.6 MB WAV archive unnecessary for a compact runtime bundle. Incomplete transfer discarded; not used. |
| OpenGameArt Overworld Theme, Louswan | CC0 individual page | Small melodic 33-second Ogg loop retained, default grass/desert suggestion. |
| OpenGameArt Pixel Sprinter, Zane Little Music | CC0 individual page | Energetic original loop version retained for castle/race. Style tags on the source page do not mean it contains Nintendo assets; this is the composer's original music. |
| OpenGameArt Subtle Bass, TinyWorlds | CC0 individual page | Quiet ambient bass loop retained for snow/editor. |

## Element coverage

All 37 canonical IDs have a runtime visual and editor palette thumbnail. A visual labeled **composed** or **supplement** is usable shipped art, not a missing file.

| Category | Canonical manifest IDs | Coverage |
|---|---|---|
| Terrain | `ground`, `brick`, `question_block`, `ice`, `slime`, `one_way`, `semi_solid` | 7/7. Native themed Kenney tiles; original ice and slime material tiles. `question_block` uses Kenney's interactive coin-block design. |
| Hazards | `spikes`, `lava`, `saw`, `falling_block` | 4/4 native SVGs. Rotation/path/fall behavior belongs to game code. |
| Dynamic | `crate`, `seesaw`, `pendulum_ball`, `chain_bridge`, `spring`, `conveyor_belt` | 6/6. Native crate, weight, spring and conveyor; original seesaw and repeatable chain-bridge link strip. Native `chain_link` and `spring_extended` also shipped. |
| Moving | `moving_platform`, `elevator`, `rotating_platform` | 3/3 original platform graphics with directional editor markings. Render each platform as a single object; animate position/rotation in game code. |
| Enemies | `walker`, `shell`, `flyer`, `jumper`, `cannon` | 5/5. Native slime, snail shell, fly and frog; original cannon. All have Phaser JSON hash atlases. Walker stomp and snail walk/kick states are separately defined. Cannon is a static pose awaiting game-controlled firing effects. |
| Items | `coin`, `big_coin`, `key`, `powerup_double_jump`, `powerup_dash` | 5/5. Native coin/key, enlarged native big coin, original double-arrow/lightning badges. |
| Flow | `start`, `checkpoint`, `goal`, `door`, `locked_door`, `switch`, `switch_block` | 7/7. Native sign/flags/switch/block, full-height door compositions with key-lock overlay. Door art serves linked teleports; a separate pipe variant is optional under §3.2. |
| Themes and backgrounds | `grass`, `desert`, `snow`, `castle` | 4/4 tilesets, each with identical terrain index ordering. Native grass/desert backgrounds; original snow mountains and castle silhouettes. All backgrounds repeat horizontally. |
| Player animations | `green`, `pink`, `purple`, `beige`: `idle`, `walk`, `run`, `jump`, `fall`, `skid`, `crouch` | 4×7 states. Walk and run share two native poses at different rates; fall and skid are explicitly derived poses, not newly drawn multi-frame animation cycles. |
| UI / palette | 13 UI images, 14 tools, 37 element thumbnails | Covered. All runtime images are PNG, with SVG companions where available. |
| Gameplay SFX | `jump`, `coin`, `stomp`, `spring`, `death`, `goal` | 6/6 Oggs; plus one menu click. Stomp uses a short bump, spring uses the high-jump sound, death uses hurt, goal uses a jingle. |
| Level music | `grass_01`, `snow_01`, `castle_01` | 3 original CC0 Ogg loops. Set `loop: true` from the manifest; desert may reuse `grass_01`. |

## Remaining polish opportunities

No requested element is missing a loadable visual. Some assets are intentionally assembled or adapted: dedicated run/fall/skid animation cycles, an animated cannon firing pose, richer multilayer snow/castle scenery and a separate pipe skin would improve polish. The manifest notes these choices. Supplemental mechanisms use simple restrained shapes and colors to remain readable beside Kenney art. Replace them only with equally traceable CC0 art (or explicitly attributed CC-BY if the project relaxes its CC0-only spec).

Characters remain 128px square for bottom-center anchoring; terrain is 64px. The level's logical 18/21px grid can scale sprites independently. Colliders, friction, AI and constraints are defined by the game package, not inferred from sprite opacity. The files do not imply that any gameplay behavior is already implemented.

## Reproduction and verification

`npm run build:assets` reads the committed input subset and writes only `web/public/assets/`. Full archives remain ignored. `scripts/supplements.py` and `scripts/curate.py` can regenerate the input subset after downloading, but normal builds do not require Python or the network. `npm run check` uses TypeScript strict with unchecked-index checking. `npm run verify` checks all canonical IDs, seven animation states per player, atlas frames/bounds, theme grids, required audio and every manifest file reference, and enforces a 40 MiB runtime limit. `npm run preview` creates `assets/PREVIEW.png` for visual review. Music files are decoded with ffmpeg for format integrity; the authors describe them as loops, but browser audio transition behavior still depends on the game's Web Audio playback implementation.
