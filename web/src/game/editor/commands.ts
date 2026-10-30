/**
 * Editor command stack (SPEC §3.3: command pattern, 100 steps).
 * Commands mutate an EditorModel; scenes re-render from the model after each do/undo.
 */
import type { EntityProps, LevelEntity } from '../level/types';

export interface EditorModel {
    getTile(x: number, y: number): number;
    setTile(x: number, y: number, value: number): void;
    getEntity(id: number): LevelEntity | undefined;
    addEntity(entity: LevelEntity): void;
    removeEntity(id: number): void;
    moveEntity(id: number, x: number, y: number): void;
    setEntityProps(id: number, props: EntityProps | undefined): void;
}

export interface Command {
    readonly label: string;
    do(m: EditorModel): void;
    undo(m: EditorModel): void;
}

export interface TileChange {
    x: number;
    y: number;
    from: number;
    to: number;
}

export class SetTilesCommand implements Command {
    readonly label: string;
    constructor(private readonly changes: TileChange[], label = 'Paint tiles') {
        this.label = label;
    }
    get size() {
        return this.changes.length;
    }
    do(m: EditorModel) {
        for (const c of this.changes) m.setTile(c.x, c.y, c.to);
    }
    undo(m: EditorModel) {
        for (let i = this.changes.length - 1; i >= 0; i--) {
            const c = this.changes[i];
            m.setTile(c.x, c.y, c.from);
        }
    }
}

export class AddEntityCommand implements Command {
    readonly label = 'Add element';
    constructor(private readonly entity: LevelEntity) {}
    do(m: EditorModel) {
        m.addEntity(structuredClone(this.entity));
    }
    undo(m: EditorModel) {
        m.removeEntity(this.entity.id);
    }
}

export class RemoveEntityCommand implements Command {
    readonly label = 'Remove element';
    constructor(private readonly entity: LevelEntity) {}
    do(m: EditorModel) {
        m.removeEntity(this.entity.id);
    }
    undo(m: EditorModel) {
        m.addEntity(structuredClone(this.entity));
    }
}

export class MoveEntityCommand implements Command {
    readonly label = 'Move element';
    constructor(
        private readonly id: number,
        private readonly from: { x: number; y: number },
        private readonly to: { x: number; y: number },
    ) {}
    do(m: EditorModel) {
        m.moveEntity(this.id, this.to.x, this.to.y);
    }
    undo(m: EditorModel) {
        m.moveEntity(this.id, this.from.x, this.from.y);
    }
}

export class UpdatePropsCommand implements Command {
    readonly label = 'Edit properties';
    constructor(
        private readonly id: number,
        private readonly before: EntityProps | undefined,
        private readonly after: EntityProps | undefined,
    ) {}
    do(m: EditorModel) {
        m.setEntityProps(this.id, this.after && structuredClone(this.after));
    }
    undo(m: EditorModel) {
        m.setEntityProps(this.id, this.before && structuredClone(this.before));
    }
}

export class CompositeCommand implements Command {
    constructor(readonly label: string, private readonly commands: Command[]) {}
    do(m: EditorModel) {
        this.commands.forEach((c) => c.do(m));
    }
    undo(m: EditorModel) {
        [...this.commands].reverse().forEach((c) => c.undo(m));
    }
}

export class CommandStack {
    private done: Command[] = [];
    private undone: Command[] = [];

    constructor(readonly limit = 100) {}

    /** Run a command and record it. */
    execute(cmd: Command, m: EditorModel) {
        cmd.do(m);
        this.push(cmd);
    }

    /** Record a command whose effect has already been applied (e.g. a paint stroke). */
    push(cmd: Command) {
        this.done.push(cmd);
        if (this.done.length > this.limit) this.done.shift();
        this.undone = [];
    }

    undo(m: EditorModel): Command | undefined {
        const cmd = this.done.pop();
        if (!cmd) return undefined;
        cmd.undo(m);
        this.undone.push(cmd);
        return cmd;
    }

    redo(m: EditorModel): Command | undefined {
        const cmd = this.undone.pop();
        if (!cmd) return undefined;
        cmd.do(m);
        this.done.push(cmd);
        return cmd;
    }

    get canUndo() {
        return this.done.length > 0;
    }
    get canRedo() {
        return this.undone.length > 0;
    }
    clear() {
        this.done = [];
        this.undone = [];
    }
}
