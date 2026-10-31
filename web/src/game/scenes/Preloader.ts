import Phaser from 'phaser';
import { EventBus } from '../EventBus';
import { REG, SCENES } from '../constants';
import { ELEMENTS } from '../level/catalog';
import { elementTexture, getAnimations, isPixelArt, pruneMissing, readManifest, type ManifestFile } from '../assets/registry';
import { fetchPackManifest, manifestUrl, selectedPack } from '../assets/pack';
import { prepareArtwork } from '../render/artwork';
import { generatePlaceholderTextures } from '../assets/placeholders';


/** Never block the game on slow/broken art: start with placeholders after this long. */
const LOAD_TIMEOUT_MS = 15000;

/**
 * Two-pass loader:
 *  1. fetch the selected pack, falling back from Mario to Kenney;
 *  2. if present, queue every file it references; individual file errors are tolerated;
 *  3. generate placeholder textures for anything still missing, then start the requested scene.
 */
export class Preloader extends Phaser.Scene {
    private failed = 0;
    private done = false;
    private cancelled = false;
    private bar?: Phaser.GameObjects.Rectangle;

    constructor() {
        super(SCENES.Preloader);
    }

    init() {
        this.cancelled = false;
        this.done = false;
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.cancelled = true; });
        this.events.once(Phaser.Scenes.Events.DESTROY, () => { this.cancelled = true; });
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
            console.warn(`[Preloader] failed to load ${file.key} (${String(file.url)})`);
        });
    }

    create() {
        void this.loadPack();
    }

    private async loadPack() {
        try {
            const { manifest, pack } = await fetchPackManifest(selectedPack());
            if (this.cancelled) return;
            this.registry.set('assetPack', pack);
            this.registry.set(REG.manifest, manifest);
            // TileSprite creates internal textures using this flag. Fallback must restore linear filtering.
            Object.assign(this.game.config, { antialias: (manifest as { pixelArt?: boolean }).pixelArt !== true });
            const files = readManifest(manifest, [...ELEMENTS.map((e) => e.type), 'player'], manifestUrl(pack).replace(/[^/]+$/, ''));
            files.forEach((f) => this.queue(f));
            this.load.once(Phaser.Loader.Events.COMPLETE, () => this.finish(true));
            this.time.delayedCall(LOAD_TIMEOUT_MS, () => this.finish(true));
            this.load.start();
        } catch (error) {
            if (this.cancelled) return;
            console.warn('[Preloader] No asset pack available', error);
            this.finish(false);
        }
    }

    private queue(f: ManifestFile) {
        switch (f.kind) {
            case 'image':
                this.load.image(f.key, f.url);
                break;
            case 'atlas':
                this.load.atlas(f.key, f.textureURL, f.atlasURL);
                break;
            case 'sheet':
                this.load.spritesheet(f.key, f.url, { frameWidth: f.frameWidth, frameHeight: f.frameHeight, margin: f.margin, spacing: f.spacing });
                break;
            case 'audio':
                this.load.audio(f.key, f.urls);
                break;
        }
    }

    private finish(hasManifest: boolean) {
        if (this.done || this.cancelled) return;
        this.done = true;
        pruneMissing((key) => this.textures.exists(key));
        prepareArtwork(this);
        for (const a of getAnimations()) {
            if (!this.textures.exists(a.texture) || this.anims.exists(a.key)) continue;
            const tex = this.textures.get(a.texture);
            const frames = a.frames.filter((f) => tex.has(f)).map((frame) => ({ key: a.texture, frame }));
            if (frames.length) this.anims.create({ key: a.key, frames, frameRate: a.frameRate, repeat: a.repeat });
        }
        for (const [type, alternate, fps] of [['coin', 'coin_side', 6], ['big_coin', 'coin_side', 6], ['goal', 'goal_wave', 4]] as const) {
            const first = elementTexture(type), second = elementTexture(alternate);
            const key = `${first.key}:idle`;
            const existing = this.anims.get(key);
            // A static HD replacement may expose a one-frame idle; keep the real side frame spinning.
            if ((!existing || existing.frames.length < 2) && first.key !== second.key && this.textures.exists(first.key) && this.textures.exists(second.key)) {
                if (existing) this.anims.remove(key);
                this.anims.create({ key, frames: [{ key: first.key, frame: first.frame }, { key: second.key, frame: second.frame }], frameRate: fps, repeat: -1 });
            }
        }
        const generated = generatePlaceholderTextures(this);
        EventBus.emit('assets-ready', { manifest: hasManifest, textures: this.textures.getTextureKeys().length, pack: this.registry.get('assetPack'), pixelArt: isPixelArt() });
        if (this.failed > 1) console.warn(`[Preloader] ${this.failed} asset(s) failed; placeholders generated: ${generated}`);
        const target = (this.registry.get(REG.startScene) as string | undefined) ?? SCENES.Play;
        const data = this.registry.get(REG.startData) as object | undefined;
        this.scene.start(target, data);
    }
}
