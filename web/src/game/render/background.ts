import Phaser from 'phaser';
import { themeLayers } from '../assets/registry';

/** Camera-space layers: cover the viewport at every zoom and tile horizontally in world space. */
export function createBackground(scene: Phaser.Scene, theme: string, dim = false) {
    const layers = themeLayers(theme).filter((l) => scene.textures.exists(l.key)).map((layer, i) => ({
        ...layer,
        sprite: scene.add.tileSprite(0, 0, 1, 1, layer.key).setOrigin(0.5).setScrollFactor(0).setDepth(-100 + i).setAlpha(dim ? 0.7 : 1),
    }));
    const update = () => {
        const cam = scene.cameras.main;
        const width = cam.width / cam.zoom, height = cam.height / cam.zoom;
        for (const layer of layers) {
            const sprite = layer.sprite;
            const source = scene.textures.get(layer.key).getSourceImage();
            // Camera zoom is around viewport centre, even for scrollFactor(0) objects.
            const w = Math.ceil(width) + 4, h = Math.ceil(height) + 4;
            sprite.setPosition(cam.width / 2, cam.height / 2);
            // Canvas dimensions are integral. Fractional sizes reset the internal canvas every render.
            if (sprite.width !== w || sprite.height !== h) sprite.setSize(w, h);
            const scale = height / source.height;
            if (sprite.tileScaleX !== scale || sprite.tileScaleY !== scale) sprite.setTileScale(scale);
            // Equivalent to a world-anchored layer with scrollFactor=f under the camera's
            // centre-origin zoom. Include the centred overscan so resize cannot shift its phase.
            const x = (cam.scrollX * layer.scrollFactor + (cam.width - w) / 2) / scale;
            const y = (-(layer.y ?? 0) - (h - height) / 2) / scale;
            if (sprite.tilePositionX !== x) sprite.tilePositionX = x;
            if (sprite.tilePositionY !== y) sprite.tilePositionY = y;
        }
    };
    update();
    // Camera.preRender applies follow, rounding and bounds AFTER scene POST_UPDATE.
    // Both Phaser renderers emit the camera event after that, before drawing its children.
    const cam = scene.cameras.main;
    cam.on(Phaser.Cameras.Scene2D.Events.PRE_RENDER, update);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => cam.off(Phaser.Cameras.Scene2D.Events.PRE_RENDER, update));
    return layers;
}
