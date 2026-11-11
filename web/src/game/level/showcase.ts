import type { LevelFileV1, Theme } from './types';
import seesawLab from './samples/render-polish.level.v1.json';
import seesawHell from './samples/seesaw-hell.level.v1.json';
import demoSprint from './showcase/demo-sprint.level.v1.json';
import duoCheckpoint from './showcase/duo-checkpoint.level.v1.json';
import { createTemplate } from '../editor/templates';

/** A level made by the RealmForge team, bundled with the app: playable and remixable without any chain. */
export interface ShowcaseLevel {
    id: string;
    name: string;
    blurb: string;
    tags: string[];
    theme: Theme;
    /** Static preview in web/public/ui/showcase (falls back to the theme art when missing). */
    preview: string;
    file: () => LevelFileV1;
}

const fromJson = (json: unknown) => () => structuredClone(json) as LevelFileV1;

export const SHOWCASE: readonly ShowcaseLevel[] = [
    { id: 'demo-sprint', name: 'Demo Sprint', blurb: 'The level from the jury demo: a 10-second dash for coins and the flag.', tags: ['Demo', 'Easy'], theme: 'grass', preview: '/ui/showcase/demo-sprint.jpg', file: fromJson(demoSprint) },
    { id: 'seesaw-lab', name: 'Seesaw Power-Up Lab', blurb: 'Seesaws, power-ups and moving parts: our physics playground.', tags: ['Physics', 'Medium'], theme: 'snow', preview: '/ui/showcase/seesaw-lab.jpg', file: fromJson(seesawLab) },
    { id: 'seesaw-hell', name: 'Seesaw Hell', blurb: 'The same toys, tuned to hurt. Clear it from spawn to earn your publish.', tags: ['Physics', 'Hard'], theme: 'snow', preview: '/ui/showcase/seesaw-hell.jpg', file: fromJson(seesawHell) },
    { id: 'duo-checkpoint', name: 'Duo Checkpoint', blurb: 'Built for co-op: a halfway checkpoint the whole team respawns at.', tags: ['Co-op', 'Easy'], theme: 'grass', preview: '/ui/showcase/duo-checkpoint.jpg', file: fromJson(duoCheckpoint) },
    { id: 'staircase', name: 'Staircase', blurb: 'A rising platforming route — the editor template, ready to extend.', tags: ['Template'], theme: 'grass', preview: '/ui/showcase/staircase.jpg', file: () => createTemplate('staircase') },
    { id: 'castle-gauntlet', name: 'Castle Gauntlet', blurb: 'A short hazard and enemy course in the castle theme.', tags: ['Template', 'Medium'], theme: 'castle', preview: '/ui/showcase/castle-gauntlet.jpg', file: () => createTemplate('castle-gauntlet') },
];

export const showcaseById = (id: string | null | undefined) => SHOWCASE.find((s) => s.id === id);
