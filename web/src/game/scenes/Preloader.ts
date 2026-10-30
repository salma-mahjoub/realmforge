import Phaser from 'phaser';
import { EventBus } from '../EventBus';
import { REG, SCENES } from '../constants';
import { ELEMENTS } from '../level/catalog';
import { getAnimations, pruneMissing, readManifest, type ManifestFile } from '../assets/registry';
import { generatePlaceholderTextures } from '../assets/placeholders';

const MANIFEST_KEY = 'rf-manifest';
const MANIFEST_URL = '/assets/manifest.json';
/** Never block the game on slow/broken art: start with placeholders after this long. */
const LOAD_TIMEOUT_MS = 15000;

/**
 * Two-pass loader:
 *  1. try to fetch /assets/manifest.json (may be absent while asset-pipeline is still working);
 *  2. if present, queue every file it references; individual file errors are tolerated;
 *  3. generate placeholder textures for anything still missing, then start the requested scene.
 */
export class Preloader extends Phaser.Scene {
    private failed = 0;
    private done = false;
    private bar?: Phaser.GameObjects.Rectangle;

    constructor() {
        super(SCENES.Preloader);
    }

    init() {
        const { width, height } = this.scale;
        this.cameras.main.setBackgroundColor('#0f1424');
        this.add.rectangle(width / 2, height / 2, 320, 14).setStrokeStyle(2, 0x7c5cff);
        this.bar = this.add.rectangle(width / 2 - 158, height / 2, 4, 10, 0xffc83d).setOrigin(0, 0.5);
        this.add
            .text(width / 2, height / 2 - 32, 'Forging realm…', { fontFamily: 'system-ui, sans-serif', fontSize: '18px', color: '#c9cff5' })
            .setOrigin(0.5);
        this.load.on('progress', (p: number) => this.bar?.setSize(4 + 312 * p, 10));
        this.load.on('loaderror', (file: Phaser.Loader.File) => {
            this.failed++;
            if (file.key !== MANIFEST_KEY) console.warn(`[Preloader] failed to load ${file.key} (${String(file.url)})`);
        });
    }

    preload() {
        this.load.json(MANIFEST_KEY, MANIFEST_URL);
    }

    create() {
        const manifest: unknown = this.cache.json.get(MANIFEST_KEY);
        if (manifest && typeof manifest === 'object') {
            this.registry.set(REG.manifest, manifest);
            const knownTypes = [...ELEMENTS.map((e) => e.type), 'player'];
            const files = readManifest(manifest, knownTypes);
            if (files.length) {
                files.forEach((f) => this.queue(f));
                this.load.once(Phaser.Loader.Events.COMPLETE, () => this.finish(true));
                this.time.delayedCall(LOAD_TIMEOUT_MS, () => {
                    if (!this.done) console.warn('[Preloader] asset load timed out — continuing with placeholders');
                    this.finish(true);
                });
                this.load.start();
                return;
            }
        } else {
            console.info('[Preloader] /assets/manifest.json not found — using generated placeholder textures');
        }
        this.finish(Boolean(manifest));
    }

    private queue(f: ManifestFile) {
        switch (f.kind) {
            case 'image':
                this.load.image(f.key, f.url);
                break;
            case 'atlas':
                this.load.atlas(f.key, f.textureURL, f.atlasURL);
                break;
            case 'audio':
                this.load.audio(f.key, f.urls);
                break;
        }
    }

    private finish(hasManifest: boolean) {
        if (this.done) return;
        this.done = true;
        pruneMissing((key) => this.textures.exists(key));
        for (const a of getAnimations()) {
            if (!this.textures.exists(a.texture) || this.anims.exists(a.key)) continue;
            const tex = this.textures.get(a.texture);
            const frames = a.frames.filter((f) => tex.has(f)).map((frame) => ({ key: a.texture, frame }));
            if (frames.length) this.anims.create({ key: a.key, frames, frameRate: a.frameRate, repeat: a.repeat });
        }
        const generated = generatePlaceholderTextures(this);
        EventBus.emit('assets-ready', { manifest: hasManifest, textures: this.textures.getTextureKeys().length });
        if (this.failed > 1) console.warn(`[Preloader] ${this.failed} asset(s) failed; placeholders generated: ${generated}`);
        const target = (this.registry.get(REG.startScene) as string | undefined) ?? SCENES.Play;
        const data = this.registry.get(REG.startData) as object | undefined;
        this.scene.start(target, data);
    }
}
