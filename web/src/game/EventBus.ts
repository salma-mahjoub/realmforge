import { Events } from 'phaser';
import type { ElementType, EntityProps, LevelEntity, LevelFileV1 } from './level/types';

/**
 * React ⇄ Phaser bridge (SPEC §2). Based on the EventBus of phaserjs/template-react-ts (MIT),
 * with a typed event map so both sides agree on payloads.
 */
export type EditorTool = 'place' | 'erase' | 'select' | 'link';
export type GameMode = 'edit' | 'test';

export interface EditorStatus {
    tool: EditorTool;
    element: ElementType;
    mode: GameMode;
    canUndo: boolean;
    canRedo: boolean;
    zoom: number;
    grid: boolean;
    cursor: { x: number; y: number } | null;
    dirty: boolean;
}

export interface HudState {
    timeMs: number;
    coins: number;
    checkpoint: string | null;
    lives?: number;
}

export interface RunFinished {
    levelId: string | null;
    timeMs: number;
    coins: number;
    cleared: boolean;
    /** Compact input log, `frame,buttons` pairs (SPEC §3.6). */
    inputs: Array<[frame: number, buttons: number]>;
}

export interface RemotePlayerState {
    sessionId: string;
    address: string;
    color: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    anim?: string;
}

export interface BusEvents {
    // lifecycle
    'current-scene-ready': [scene: Phaser.Scene];
    'assets-ready': [info: { manifest: boolean; textures: number }];

    // React → EditorScene
    'editor:set-tool': [tool: EditorTool];
    'editor:set-element': [type: ElementType];
    'editor:undo': [];
    'editor:redo': [];
    'editor:toggle-test': [];
    'editor:toggle-grid': [];
    'editor:zoom': [zoom: number];
    'editor:load-level': [level: LevelFileV1];
    'editor:update-props': [payload: { id: number; props: EntityProps }];
    'editor:delete-selected': [];
    'editor:request-snapshot': [];

    // EditorScene → React
    'editor:status': [status: EditorStatus];
    'editor:selection': [entity: LevelEntity | null];
    'editor:level-changed': [level: LevelFileV1];
    'editor:snapshot': [dataUrl: string];

    // Play / Race scenes → React
    'play:hud': [hud: HudState];
    'play:finished': [result: RunFinished];
    'play:died': [];

    // React → Play / Race scenes
    'play:load-level': [payload: { levelId: string | null; level: LevelFileV1 }];
    'play:restart': [];
    'play:pause': [paused: boolean];
    'race:remote-states': [players: RemotePlayerState[]];
    'race:local-state': [state: Omit<RemotePlayerState, 'sessionId' | 'address' | 'color'>];
}

type Handler<K extends keyof BusEvents> = (...args: BusEvents[K]) => void;

class TypedBus {
    private readonly ee = new Events.EventEmitter();

    emit<K extends keyof BusEvents>(event: K, ...args: BusEvents[K]): boolean {
        return this.ee.emit(event, ...args);
    }

    on<K extends keyof BusEvents>(event: K, fn: Handler<K>, context?: unknown): this {
        this.ee.on(event, fn as (...a: unknown[]) => void, context);
        return this;
    }

    once<K extends keyof BusEvents>(event: K, fn: Handler<K>, context?: unknown): this {
        this.ee.once(event, fn as (...a: unknown[]) => void, context);
        return this;
    }

    off<K extends keyof BusEvents>(event: K, fn?: Handler<K>, context?: unknown): this {
        this.ee.off(event, fn as ((...a: unknown[]) => void) | undefined, context);
        return this;
    }

    /** Subscribe and get an unsubscribe function — convenient in React effects. */
    subscribe<K extends keyof BusEvents>(event: K, fn: Handler<K>): () => void {
        this.on(event, fn);
        return () => {
            this.off(event, fn);
        };
    }
}

export const EventBus = new TypedBus();
