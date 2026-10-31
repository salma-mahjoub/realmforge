import Phaser from 'phaser';
import {createElementRuntime, type ElementInstance} from '../src/elements/index';
import type {ElementTexture} from '../src/elements/display';
import {SEESAW} from '../src/elements/seesaw';
import {createMatterPlayer} from '../src/adapters/phaserMatter';
import {EMPTY_INPUT, type InputState} from '../src/input';
import {FIXED_MS} from '../src/constants';

type Scenario = 'rest' | 'left' | 'right' | 'fall';
interface Manifest {baseUrl: string; elements: Record<string, ElementTexture & {path: string}>}
class SeesawLab extends Phaser.Scene {
    private runtime!: ReturnType<typeof createElementRuntime>;
    private player!: ReturnType<typeof createMatterPlayer>;
    private element!: ElementInstance;
    private outlines!: Phaser.GameObjects.Graphics;
    private keyboard!: Record<string, Phaser.Input.Keyboard.Key>;
    private forcedInput?: InputState;
    private paused = true;
    private accumulator = 0;
    private scenario: Scenario = 'rest';
    private readonly tile = 64;

    preload() {
        this.load.json('manifest', '/packs/mario/manifest.json');
        this.load.once('filecomplete-json-manifest', () => {
            const m = this.cache.json.get('manifest') as Manifest;
            for (const id of ['seesaw', 'seesaw_pivot']) {
                const ref = m.elements[id]; if (ref) this.load.image(ref.texture, m.baseUrl + ref.path);
            }
        });
    }
    create() {
        this.matter.world.autoUpdate = false;
        this.keyboard = this.input.keyboard!.addKeys('LEFT,RIGHT,SHIFT,SPACE') as typeof this.keyboard;
        const grid = this.add.graphics().setDepth(-3);
        grid.lineStyle(1, 0x28334f);
        for (let x = 0; x < 1000; x += this.tile) grid.lineBetween(x, 0, x, 580);
        for (let y = 0; y < 580; y += this.tile) grid.lineBetween(0, y, 1000, y);
        this.outlines = this.add.graphics().setDepth(2);
        this.reset('rest');
        document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach(button => button.onclick = () => this.reset(button.dataset.scenario as Scenario));
        document.querySelector<HTMLButtonElement>('#step')!.onclick = () => this.advance(60);
        document.querySelector<HTMLButtonElement>('#jump')!.onclick = () => this.advance(1, {...EMPTY_INPUT, jump: true});
        document.querySelector<HTMLButtonElement>('#grow')!.onclick = () => {this.player.setForm(this.player.form === 'small' ? 'big' : 'small'); this.draw();};
        document.querySelector<HTMLButtonElement>('#play')!.onclick = () => {this.paused = !this.paused; this.accumulator = 0;};
        Object.assign(window, {seesawLab: {
            reset: (scenario: Scenario) => this.reset(scenario),
            advance: (frames: number, input?: InputState) => this.advance(frames, input),
            metrics: () => this.metrics(),
            setForm: (form: 'small' | 'big') => {this.player.setForm(form); this.draw(); return this.metrics();},
            isolatedGrowthBounds: () => {
                const probe = createMatterPlayer(this, 480, 200, {tile: this.tile});
                probe.setForm('big');
                const parent = structuredClone(probe.body.bounds), main = structuredClone(probe.body.parts[1]!.bounds);
                const result = {position: {...probe.body.position}, parent, main, parentBoundsContainMain: parent.min.x <= main.min.x && parent.max.x >= main.max.x && parent.min.y <= main.min.y && parent.max.y >= main.max.y};
                probe.destroy(); return result;
            },
        }});
    }
    private readInput = (): InputState => this.forcedInput ?? {...EMPTY_INPUT,
        left: this.keyboard.LEFT!.isDown, right: this.keyboard.RIGHT!.isDown,
        jump: this.keyboard.SPACE!.isDown, run: this.keyboard.SHIFT!.isDown};
    private reset(scenario: Scenario) {
        this.player?.destroy(); this.runtime?.destroy(); this.scenario = scenario; this.paused = true;
        this.runtime = createElementRuntime(this, {tile: this.tile, textures: (this.cache.json.get('manifest') as Manifest).elements, input: this.readInput});
        this.element = this.runtime.add({id: 'deck', type: 'seesaw', x: 7.5, y: 6, props: {length: 6}});
        const body = this.element.bodies[0]!, sign = scenario === 'left' ? -1 : 1;
        if (scenario === 'left' || scenario === 'right') this.matter.body.setAngle(body, sign * SEESAW.maxAngle);
        const x = body.position.x + (scenario === 'rest' ? 0 : sign * this.tile);
        const top = body.position.y + (x - body.position.x) * Math.tan(body.angle) - this.tile * SEESAW.thickness / (2 * Math.cos(body.angle));
        this.player = createMatterPlayer(this, x, top - 30 - (scenario === 'rest' ? 6 : 70), {tile: this.tile, input: this.readInput, surface: this.runtime.surface, carry: this.runtime.carry});
        this.runtime.attachPlayer(this.player); this.draw(); return this.metrics();
    }
    private collisions(body: MatterJS.BodyType) {
        const query = this.matter.query as MatterJS.QueryFactory & {collides(body: MatterJS.BodyType, bodies: MatterJS.BodyType[]): Array<{depth: number}>};
        return query.collides(body, [this.element.bodies[0]!]);
    }
    private metrics() {
        const body = this.element.bodies[0]!, main = this.player.body.parts[1]!, bounds = this.player.body.bounds;
        return {scenario: this.scenario, frame: this.player.state.frame, angleDegrees: body.angle * 180 / Math.PI,
            deck: {width: 384, thickness: this.tile * SEESAW.thickness}, mass: body.mass, inertia: body.inertia,
            hingeError: Math.hypot(body.position.x - 480, body.position.y - 384),
            player: {x: this.player.body.position.x, y: this.player.body.position.y, form: this.player.form, vy: this.player.state.vy},
            footContact: this.collisions(this.player.sensors.foot).length > 0,
            mainPenetration: this.collisions(main)[0]?.depth ?? 0,
            parentBoundsContainMain: bounds.min.x <= main.bounds.min.x && bounds.max.x >= main.bounds.max.x && bounds.min.y <= main.bounds.min.y && bounds.max.y >= main.bounds.max.y,
        };
    }
    private advance(frames: number, input: InputState = EMPTY_INPUT) {
        if (!Number.isInteger(frames) || frames < 1 || frames > 3600) throw new RangeError('frames must be 1…3600');
        this.forcedInput = input;
        const samples: ReturnType<SeesawLab['metrics']>[] = [];
        for (let frame = 0; frame < frames; frame++) {this.matter.world.step(FIXED_MS); samples.push(this.metrics());}
        this.forcedInput = undefined; this.draw();
        return {last: samples.at(-1)!, footContacts: samples.filter(s => s.footContact).length,
            verticalRange: Math.max(...samples.map(s => s.player.y)) - Math.min(...samples.map(s => s.player.y)),
            horizontalRange: Math.max(...samples.map(s => s.player.x)) - Math.min(...samples.map(s => s.player.x)),
            maxPenetration: Math.max(...samples.map(s => s.mainPenetration)), maxHingeError: Math.max(...samples.map(s => s.hingeError))};
    }
    private draw() {
        const body = this.element.bodies[0]!, main = this.player.body.parts[1]!, foot = this.player.sensors.foot;
        this.outlines.clear();
        for (const [part, color] of [[body, 0x7c5cff], [main, 0xffc83d], [foot, 0x67e8f9]] as const) {
            this.outlines.lineStyle(2, color).strokePoints(part.vertices as Phaser.Types.Math.Vector2Like[], true);
        }
        this.outlines.fillStyle(0xffc83d).fillCircle(480, 384, 4);
        const m = this.metrics();
        document.querySelector('#metrics')!.textContent = `${this.scenario} · frame ${m.frame} · ${m.player.form} · angle ${m.angleDegrees.toFixed(3)}° · deck 384 × ${m.deck.thickness.toFixed(1)} px\nFoot contact ${m.footContact} · penetration ${m.mainPenetration.toFixed(3)} px · hinge error ${m.hingeError.toExponential(2)} px\nParent bounds contain hull: ${m.parentBoundsContainMain}${m.parentBoundsContainMain ? '' : ' — existing growth broadphase issue; see validation notes'}`;
    }
    update(_time: number, delta: number) {
        if (!this.player) return;
        if (!this.paused) {
            this.accumulator += Math.min(delta, 250);
            while (this.accumulator >= FIXED_MS) {this.matter.world.step(FIXED_MS); this.accumulator -= FIXED_MS;}
        }
        this.draw();
    }
}
new Phaser.Game({type: Phaser.AUTO, parent: 'game', width: 1000, height: 580, backgroundColor: '#182037',
    physics: {default: 'matter', matter: {gravity: {x: 0, y: 1}, runner: {fps: 60}, debug: false}}, scene: SeesawLab});
