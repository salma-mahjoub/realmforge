import { describe, expect, it } from 'vitest';
import { copySelection, normalizedRect, pasteSelection } from './selection';
import { createEmptyLevel, encodeLevel } from '../level/serialize';
import { AddEntityCommand, CommandStack, CompositeCommand, SetTilesCommand, type EditorModel } from './commands';

describe('editor rectangular clipboard', () => {
    it('normalizes either drag direction and preserves relative tile/entity positions', () => {
        const doc = createEmptyLevel(8, 6);
        const terrain = new Uint8Array(8 * 6);
        terrain[2 * 8 + 3] = 2;
        const entities = [{ id: 9, type: 'coin' as const, x: 4, y: 3, props: { reward: 'bonus' } }];
        const rect = normalizedRect({ x: 5, y: 4 }, { x: 3, y: 2 });
        const clipboard = copySelection(rect, terrain, doc.size.w, entities);
        expect(clipboard.tiles).toEqual([{ x: 0, y: 0, value: 2 }]);
        expect(clipboard.entities).toEqual([{ sourceId: 9, type: 'coin', x: 1, y: 1, props: { reward: 'bonus' } }]);
        const pasted = pasteSelection(clipboard, { x: 1, y: 1 }, 10);
        expect(pasted).toEqual({ tiles: [{ x: 1, y: 1, value: 2 }], entities: [{ id: 10, type: 'coin', x: 2, y: 2, props: { reward: 'bonus' } }] });
        expect(encodeLevel(doc).schema).toBe(1);
    });

    it('keeps empty cells empty and allocates distinct entity ids on repeated pastes', () => {
        const clipboard = copySelection({ left: 0, top: 0, right: 2, bottom: 2 }, new Uint8Array(9), 3, [
            { id: 1, type: 'coin', x: 1, y: 1 }, { id: 2, type: 'key', x: 2, y: 2 },
        ]);
        expect(clipboard.tiles).toEqual([]);
        expect(pasteSelection(clipboard, { x: 4, y: 4 }, 20).entities.map((e) => e.id)).toEqual([20, 21]);
        expect(pasteSelection(clipboard, { x: 5, y: 5 }, 22).entities.map((e) => e.id)).toEqual([22, 23]);
    });

    it('remaps links between entities copied together', () => {
        const clipboard = copySelection({ left: 0, top: 0, right: 4, bottom: 2 }, new Uint8Array(15), 5, [
            { id: 4, type: 'door', x: 1, y: 2, props: { link: 7 } },
            { id: 7, type: 'door', x: 3, y: 2, props: { link: 4 } },
        ]);
        const pasted = pasteSelection(clipboard, { x: 10, y: 4 }, 20);
        expect(pasted.entities.map((e) => e.props?.link)).toEqual([21, 20]);
    });

    it('records clipboard paste as one undoable and redoable history entry', () => {
        const entities = new Map<number, any>();
        const tiles = new Map<string, number>();
        const model: EditorModel = {
            getTile: (x, y) => tiles.get(`${x},${y}`) ?? 0,
            setTile: (x, y, value) => { tiles.set(`${x},${y}`, value); },
            getEntity: (id) => entities.get(id),
            addEntity: (e) => { entities.set(e.id, e); },
            removeEntity: (id) => { entities.delete(id); },
            moveEntity: () => {}, setEntityProps: () => {},
        };
        const stack = new CommandStack();
        stack.execute(new CompositeCommand('Paste', [
            new SetTilesCommand([{ x: 2, y: 3, from: 0, to: 1 }]),
            new AddEntityCommand({ id: 12, type: 'coin', x: 2, y: 2 }),
        ]), model);
        expect(model.getTile(2, 3)).toBe(1);
        expect(entities.has(12)).toBe(true);
        stack.undo(model);
        expect(model.getTile(2, 3)).toBe(0);
        expect(entities.has(12)).toBe(false);
        stack.redo(model);
        expect(model.getTile(2, 3)).toBe(1);
        expect(entities.has(12)).toBe(true);
    });
});
