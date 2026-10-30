# RealmForge assets

This is a standalone npm package. Run with Node 22 and npm 10:

```sh
cd assets
npm ci
npm run build:assets
npm run check
npm run verify
```

The curated inputs in `sources/` are committed; rebuilding does not require internet or `_downloads/`. Download archives and extracted exploratory packs stay in the root-ignored `assets/_downloads/`. `scripts/download.py` handles Kenney's session-based download flow; `scripts/download-oga.py` records the individual OpenGameArt license pages. Only `assets/` and `web/public/assets/` are written by this package.

`web/public/assets/manifest.json` uses paths relative to `/assets/`. Load standalone entries with `this.load.image(entry.texture, '/assets/' + entry.path)`. Load characters and enemies with `this.load.atlas(entry.texture, '/assets/' + entry.image, '/assets/' + entry.atlas)`; animation entries contain literal atlas frame names, frameRate, and repeat values. Atlas frame cells have two transparent padding pixels on each side and are untrimmed. Sprite origins should be bottom center; collision sizes belong to game code.

Tilesets use 64×64 cells, eight columns, zero spacing and margin. `manifest.themes[theme].tiles` maps semantic terrain IDs to zero-based tile indices (Tiled firstgid remains the caller's responsibility). Theme backgrounds are referenced in the same theme entry. The editor may use a different logical grid size; scale art to that grid.

All element entries have a standalone PNG for palettes; enemy entries additionally point to animation atlases. `manifest.editor` contains tool and element palette icons. Aliases in `manifest.elements` let hyphenated and underscored IDs address the same visuals. Custom art and adapted animation states are identified by notes and source pack IDs. These are visual assets; they do not implement physics, AI, links, timing or input.

See `CREDITS.md` and `RESEARCH.md` for provenance, licensing, coverage and remaining polish opportunities. Fonts and branding from downloaded packs are excluded.
