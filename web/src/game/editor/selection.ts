import type { LevelEntity } from '../level/types';

export interface Cell { x: number; y: number }
export interface Rect { left: number; top: number; right: number; bottom: number }
export interface ClipboardEntity extends Omit<LevelEntity, 'id' | 'x' | 'y'> { sourceId: number; x: number; y: number }
export interface EditorClipboard { rect: Rect; tiles: { x: number; y: number; value: number }[]; entities: ClipboardEntity[] }

export function normalizedRect(a: Cell, b: Cell): Rect {
    return { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), right: Math.max(a.x, b.x), bottom: Math.max(a.y, b.y) };
}

export function copySelection(rect: Rect, tiles: Uint8Array, width: number, entities: LevelEntity[]): EditorClipboard {
    const capturedTiles: EditorClipboard['tiles'] = [];
    for (let y = rect.top; y <= rect.bottom; y++) for (let x = rect.left; x <= rect.right; x++) {
        const value = tiles[y * width + x];
        if (value) capturedTiles.push({ x: x - rect.left, y: y - rect.top, value });
    }
    const capturedEntities = entities.filter((e) => e.x >= rect.left && e.x <= rect.right && e.y >= rect.top && e.y <= rect.bottom)
        .map(({ id, type, x, y, props }) => ({ sourceId: id, type, x: x - rect.left, y: y - rect.top, props: props ? structuredClone(props) : undefined }));
    return { rect: { ...rect }, tiles: capturedTiles, entities: capturedEntities };
}

export function pasteSelection(clipboard: EditorClipboard, at: Cell, nextId: number): { tiles: { x: number; y: number; value: number }[]; entities: LevelEntity[] } {
    return {
        tiles: clipboard.tiles.map((t) => ({ x: at.x + t.x, y: at.y + t.y, value: t.value })),
        entities: (() => {
            const ids = new Map(clipboard.entities.map((e, i) => [e.sourceId, nextId + i]));
            return clipboard.entities.map((entity, i) => {
                const { sourceId: _sourceId, ...e } = structuredClone(entity);
                const link = e.props?.link;
                const newLink = typeof link === 'number' ? ids.get(link) : typeof link === 'string' && /^\d+$/.test(link) ? ids.get(Number(link)) : undefined;
                const props = e.props ? { ...e.props, ...(newLink !== undefined ? { link: newLink } : {}) } : undefined;
                return { ...e, id: nextId + i, x: at.x + e.x, y: at.y + e.y, props };
            });
        })(),
    };
}
