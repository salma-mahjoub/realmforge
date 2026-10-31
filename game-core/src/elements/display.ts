import type Phaser from 'phaser';

export interface ElementTexture {
    texture: string;
    frame?: string | number;
    /** Artwork proportions relative to the body footprint; 1×1 follows the body. */
    displaySize?: { w: number; h: number };
    anchor?: { x: number; y: number };
}
const visualOffsets = new WeakMap<object, { x: number; y: number }>();
const visualSizes = new WeakMap<object, { scaleX: number; scaleY: number }>();
export type ElementVisual = Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;

/** Rendering only: never changes bodies or the fixed-step controller. */
export function createElementVisual(scene: Phaser.Scene, type: string, ref: ElementTexture, x: number, y: number, w: number, h: number, _tile: number): ElementVisual {
    // Headless game-core hosts can provide images without an animation manager.
    const visual = scene.add.sprite ? scene.add.sprite(x, y, ref.texture, ref.frame) : scene.add.image(x, y, ref.texture, ref.frame);
    const stretch = ['seesaw', 'chain_bridge', 'moving_platform', 'elevator', 'rotating_platform', 'conveyor_belt', 'one_way', 'semi_solid'].includes(type);
    visual.setDisplaySize(w * (stretch ? 1 : ref.displaySize?.w ?? 1), h * (stretch ? 1 : ref.displaySize?.h ?? 1));
    visualSizes.set(visual, { scaleX: visual.scaleX, scaleY: visual.scaleY });
    if (ref.anchor) {
        visual.setOrigin(ref.anchor.x, ref.anchor.y);
        visualOffsets.set(visual, { x: (ref.anchor.x - 0.5) * w, y: (ref.anchor.y - 0.5) * h });
        positionElementVisual(visual, x, y, 0);
    }
    const sprite = visual as Phaser.GameObjects.Sprite;
    const animation = ['walker', 'shell', 'flyer', 'jumper'].includes(type) ? ['move', 'walk', 'idle'] : ['idle', 'loop', 'move'];
    for (const name of animation) {
        const key = `${ref.texture}:${name}`;
        if (scene.anims?.exists(key) && sprite.play) { sprite.play(key); break; }
    }
    if (scene.tweens && ['lava', 'question_block', 'conveyor_belt'].includes(type)) {
        // Static-image packs still communicate heat, reward and belt motion.
        scene.tweens.add({ targets: visual, alpha: type === 'lava' ? 0.8 : 0.88, duration: type === 'conveyor_belt' ? 180 : 550, yoyo: true, repeat: -1 });
    }
    return visual;
}

export function positionElementVisual(visual: ElementVisual, x: number, y: number, angle: number) {
    const offset = visualOffsets.get(visual) ?? { x: 0, y: 0 };
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
        const key = `${visual.texture.key}:bounce`;
        if (sprite.play && scene.anims?.exists(key)) {
            sprite.play({ key, repeat: 0 });
            sprite.once('animationcomplete', () => {
                const idle = `${refTexture(sprite)}:idle`;
                if (sprite.active && scene.anims?.exists(idle)) sprite.play(idle);
            });
        }
        scene.tweens.add({ targets: visual, scaleX: scaleX * 1.15, scaleY: scaleY * 0.55, duration: 75, yoyo: true, ease: 'Sine.easeOut' });
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
