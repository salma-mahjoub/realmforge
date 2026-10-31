import Phaser from 'phaser';
import { themeLayers } from '../assets/registry';

/** Camera-space layers: cover the viewport at every zoom and tile horizontally in world space. */
export function createBackground(scene: Phaser.Scene, theme: string, dim = false) {
    const layers = themeLayers(theme).filter((l) => scene.textures.exists(l.key)).map((layer, i) => ({
        ...layer,
        sprite: scene.add.tileSprite(0, 0, 1, 1, layer.key).setOrigin(0.5).setScrollFactor(0).setDepth(-100 + i).setAlpha(dim ? 0.7 : 1),
    }));
    scene.cameras.main.setRoundPixels(true);
    const update = () => {
        const cam = scene.cameras.main;
        const width = cam.width / cam.zoom, height = cam.height / cam.zoom;
        for (const layer of layers) {
            const sprite = layer.sprite;
            const source = scene.textures.get(layer.key).getSourceImage();
            // Camera zoom is around viewport centre, even for scrollFactor(0) objects.
            sprite.setPosition(cam.width / 2, cam.height / 2).setSize(width + 4, height + 4);
            const scale = height / source.height;
            sprite.setTileScale(scale);
            sprite.tilePositionX = cam.scrollX * layer.scrollFactor / scale;
            sprite.tilePositionY = -(layer.y ?? 0) / scale;
        }
    };
    update();
    // Post-update sees camera follow's latest scroll position; editor pan/zoom uses the same path.
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, update);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.POST_UPDATE, update));
    return layers;
}
