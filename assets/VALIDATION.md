# Validation evidence

Executed 2026-10-30 using Node 22 / npm 10. Commands below completed with exit code 0.

```text
$ node --version
v22.23.2
```

```text
$ npm --version
10.9.8
```

```text
$ npm run check

> @realmforge/assets@1.0.0 check
> tsc --noEmit
```

```text
$ npm run build:assets

> @realmforge/assets@1.0.0 build:assets
> tsx scripts/build.ts

Built 143 images, 4 character atlases, 5 enemy atlases, 4 tilesets and 10 audio files.
```

```text
$ npm run verify

> @realmforge/assets@1.0.0 verify
> tsx scripts/verify.ts

PASS: 37/37 SPEC element IDs; 4 characters × 7 animations; 5 enemies; 4 themes; 6 required SFX; 3 loops.
PASS: 412 file references, atlas bounds and tileset grids; 3302284 bytes (<40 MiB).
PASS: recorded npm dependency licenses are MIT or Apache-2.0.
```

```text
$ npm run preview

> @realmforge/assets@1.0.0 preview
> tsx scripts/preview.ts

Wrote assets/PREVIEW.png
```

```text
$ npm run build:assets

> @realmforge/assets@1.0.0 build:assets
> tsx scripts/build.ts

Built 143 images, 4 character atlases, 5 enemy atlases, 4 tilesets and 10 audio files.
```

```text
$ du -sh web/public/assets
4.0M	web/public/assets
```

```text
$ git check-ignore assets/_downloads/new-platformer-pack.zip
assets/_downloads/new-platformer-pack.zip
```

PASS: two builds produced identical SHA-256 digests for all 367 output files.

Audio integrity: `ffmpeg -v error -i <file> -f null -` decoded all 10 Ogg files without errors; durations/codecs are recorded in `audio-validation.json`. The final contact sheet and the full-size green character atlas / locked door were visually reviewed.
