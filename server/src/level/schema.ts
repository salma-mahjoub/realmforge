import { z } from "zod";

/** Level file format v1 — SPEC §3.4 (`level.v1.json`). */
export const MAX_W = 300;
export const MAX_H = 30;
export const MAX_ENTITIES = 5000;

export const THEMES = ["grass", "desert", "snow", "castle"] as const;

const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string().max(1024), z.number().finite(), z.boolean(), z.null(), z.array(jsonValue).max(256), z.record(z.string(), jsonValue)]),
);

const point = z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() });

export const entitySchema = z.strictObject({
  id: z.number().int().nonnegative(),
  type: z.string().min(1).max(32).regex(/^[a-z][a-z0-9_]*$/, "lower_snake_case element type"),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  props: z.record(z.string(), jsonValue).optional(),
});

export const levelSchema = z
  .strictObject({
    schema: z.literal(1),
    meta: z.strictObject({
      name: z.string().trim().min(1).max(64),
      theme: z.enum(THEMES),
      timeLimit: z.number().int().min(10).max(3600),
      music: z.string().max(64),
    }),
    size: z.strictObject({
      w: z.number().int().min(1).max(MAX_W),
      h: z.number().int().min(1).max(MAX_H),
      tile: z.union([z.literal(18), z.literal(21)]),
    }),
    layers: z
      .record(z.string().regex(/^[a-z][a-zA-Z0-9_]*$/), z.string().max(1_000_000))
      .refine((l) => typeof l.terrain === "string", "layers.terrain is required"),
    entities: z.array(entitySchema).max(MAX_ENTITIES),
    spawn: point,
    goal: point,
  })
  .superRefine((lvl, ctx) => {
    const inBounds = (p: { x: number; y: number }) => p.x < lvl.size.w && p.y < lvl.size.h;
    if (!inBounds(lvl.spawn)) ctx.addIssue({ code: "custom", path: ["spawn"], message: "spawn out of bounds" });
    if (!inBounds(lvl.goal)) ctx.addIssue({ code: "custom", path: ["goal"], message: "goal out of bounds" });
    const ids = new Set<number>();
    lvl.entities.forEach((e, i) => {
      if (ids.has(e.id)) ctx.addIssue({ code: "custom", path: ["entities", i, "id"], message: `duplicate entity id ${e.id}` });
      ids.add(e.id);
      if (!inBounds(e)) ctx.addIssue({ code: "custom", path: ["entities", i], message: `entity ${e.id} out of bounds` });
    });
  });

export type Level = z.infer<typeof levelSchema>;
export type LevelEntity = z.infer<typeof entitySchema>;
