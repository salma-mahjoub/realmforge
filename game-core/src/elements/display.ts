import type Phaser from 'phaser';

export interface ElementTexture {
    texture: string;
    frame?: string | number;
    /** Artwork proportions relative to the body footprint; 1×1 follows the body. */
    displaySize?: { w: number; h: number };
    anchor?: { x: number; y: number };
}
const visualOffsets = new WeakMap<object, { x: number; y: number }>();
const bounceOffsets = new WeakMap<object, { y: number }>();
const visualSizes = new WeakMap<object, { scaleX: number; scaleY: number }>();
export type ElementVisual = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

/** Optional host-provided pivot art. The axle stays fixed while only the deck rotates. */
export function createSeesawPivotVisual(scene: Phaser.Scene, ref: ElementTexture | undefined, x: number, y: number, tile: number): ElementVisual | undefined {
    if (!ref || !scene.textures.exists(ref.texture)) return;
    // Same placement as the web mechanism overlay: the top overlaps the lower half
    // of a 0.45-tile deck, with the pin hidden behind it rather than floating below it.
    return scene.add.image(x, y + tile * 0.1, ref.texture, ref.frame)
        .setOrigin(0.5, 0).setDisplaySize(tile * (ref.displaySize?.w ?? 0.75), tile * (ref.displaySize?.h ?? 0.75)).setDepth(-1);
}

/** Rendering only: never changes bodies or the fixed-step controller. */
export function createElementVisual(scene: Phaser.Scene, type: string, ref: ElementTexture, x: number, y: number, w: number, h: number, _tile: number): ElementVisual {
    // Headless game-core hosts can provide images without an animation manager.
    const visual = scene.add.sprite ? scene.add.sprite(x, y, ref.texture, ref.frame) : scene.add.image(x, y, ref.texture, ref.frame);
    // Host presentation can associate visuals with elements without exposing or changing physics.
    visual.setData?.('elementType', type);
    visual.setData?.('elementCentre', { x, y });
    // Stretch platforms to the actual Matter deck, including the seesaw's 0.45-tile thickness.
    const stretch = ['seesaw', 'chain_bridge', 'moving_platform', 'elevator', 'rotating_platform', 'conveyor_belt', 'one_way', 'semi_solid'].includes(type);
    visual.setDisplaySize(w * (stretch ? 1 : ref.displaySize?.w ?? 1), h * (stretch ? 1 : ref.displaySize?.h ?? 1));
    visualSizes.set(visual, { scaleX: visual.scaleX, scaleY: visual.scaleY });
    if (ref.anchor) {
        visual.setOrigin(ref.anchor.x, ref.anchor.y);
        visualOffsets.set(visual, { x: (ref.anchor.x - 0.5) * w, y: (ref.anchor.y - 0.5) * h });
        positionElementVisual(visual, x, y, 0);
    }
    const sprite = visual as Phaser.GameObjects.Sprite;
    const animation = type === 'flyer' ? ['fly', 'move', 'walk', 'idle'] : type === 'jumper' ? ['jump', 'move', 'idle'] : ['walker', 'shell'].includes(type) ? ['walk', 'move', 'idle'] : ['idle', 'closed', 'loop', 'move'];
    if (['coin', 'big_coin'].includes(type) && sprite.on) {
        // Cross-texture fallback frames can have different native resolutions. Keep their height
        // constant while allowing the changing aspect ratio to show the coin turning.
        const aspect = visual.width / Math.max(1, visual.height);
        const fitFrame = () => visual.setDisplaySize(w * (ref.displaySize?.w ?? 1) * visual.width / Math.max(1, visual.height) / aspect, h * (ref.displaySize?.h ?? 1));
        sprite.on('animationupdate', fitFrame);
    }
    if (['walker', 'shell', 'flyer', 'jumper'].includes(type) && sprite.on) {
        // Authentic shell/rest and walking frames can use different atlas cell sizes.
        // Keep the enemy's authored footprint stable when Phaser swaps native frame dimensions.
        sprite.on('animationupdate', () => visual.setDisplaySize(w * (ref.displaySize?.w ?? 1), h * (ref.displaySize?.h ?? 1)));
    }
    let animated = false;
    for (const name of animation) {
        const key = `${ref.texture}:${name}`;
        if (scene.anims?.exists(key) && sprite.play) { sprite.play(key); animated = (scene.anims.get(key)?.frames.length ?? 0) > 1; break; }
    }
    if (!animated && scene.tweens && ['lava', 'question_block', 'conveyor_belt'].includes(type)) {
        // Static-image packs still communicate heat, reward and belt motion.
        scene.tweens.add({ targets: visual, alpha: type === 'lava' ? 0.8 : 0.88, duration: type === 'conveyor_belt' ? 180 : 550, yoyo: true, repeat: -1 });
    }
    return visual;
}

export function positionElementVisual(visual: ElementVisual, x: number, y: number, angle: number) {
    const offset = visualOffsets.get(visual) ?? { x: 0, y: 0 };
    y += bounceOffsets.get(visual)?.y ?? 0;
    visual.setPosition(x + offset.x * Math.cos(angle) - offset.y * Math.sin(angle), y + offset.x * Math.sin(angle) + offset.y * Math.cos(angle)).setRotation(angle);
}

const refTexture = (sprite: Phaser.GameObjects.Sprite) => sprite.anims.currentAnim?.frames[0]?.textureKey ?? sprite.texture.key;

export function bounceVisuals(scene: Phaser.Scene, visuals: ElementVisual[]) {
    for (const visual of visuals) {
        if (!scene.tweens) continue;
        scene.tweens.killTweensOf(visual);
        const { scaleX, scaleY } = visualSizes.get(visual) ?? visual;
        visual.setScale(scaleX, scaleY);
        const sprite = visual as Phaser.GameObjects.Sprite;
        const key = [`${visual.texture.key}:compress`, `${visual.texture.key}:bump`, `${visual.texture.key}:bounce`].find((k) => scene.anims?.exists(k)) ?? `${visual.texture.key}:bounce`;
        if (sprite.play && scene.anims?.exists(key)) {
            sprite.play({ key, repeat: 0 });
            sprite.once('animationcomplete', () => {
                const texture = refTexture(sprite);
                const extend = `${texture}:extend`;
                const idle = `${texture}:${sprite.getData?.('restAnimation') ?? 'idle'}`;
                if (sprite.active && scene.anims?.exists(extend)) {
                    sprite.play({ key: extend, repeat: 0 });
                    sprite.once('animationcomplete', () => { if (sprite.active && scene.anims?.exists(idle)) sprite.play(idle); });
                } else if (sprite.active && scene.anims?.exists(idle)) sprite.play(idle);
            });
        }
        const type = visual.getData?.('elementType');
        if (type === 'question_block' || type === 'brick') {
            let offset = bounceOffsets.get(visual);
            if (!offset) { offset = { y: 0 }; bounceOffsets.set(visual, offset); }
            scene.tweens.killTweensOf(offset);
            offset.y = 0;
            scene.tweens.add({ targets: offset, y: -visual.displayHeight * 0.18, duration: 80, yoyo: true, ease: 'Quad.easeOut' });
        } else scene.tweens.add({ targets: visual, scaleX: scaleX * 1.1, scaleY: scaleY * 0.55, duration: 85, yoyo: true, ease: 'Sine.easeOut' });
    }
}

/** A short squash survives removal of an enemy's collision body. */
export function stompVisuals(scene: Phaser.Scene, visuals: ElementVisual[]) {
    if (!scene.tweens || !scene.add.sprite) return;
    for (const visual of visuals) {
        const ghost = scene.add.sprite(visual.x, visual.y, visual.texture.key, visual.frame.name)
            .setDisplaySize(visual.displayWidth, visual.displayHeight).setDepth(visual.depth).setOrigin(0.5, 1);
        ghost.y += (1 - visual.originY) * visual.displayHeight;
        const key = `${visual.texture.key}:stomp`;
        if (scene.anims.exists(key)) ghost.play(key);
        scene.tweens.add({ targets: ghost, scaleY: ghost.scaleY * 0.25, alpha: 0, duration: 220, onComplete: () => ghost.destroy() });
    }
}
