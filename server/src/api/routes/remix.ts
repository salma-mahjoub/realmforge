import type { FastifyInstance } from "fastify";
import type { Services } from "../../services.js";
import { badRequest } from "../errors.js";
import { idParamSchema } from "../schemas.js";
import { LEVEL_SELECT } from "../queries.js";

/** Longest ancestor chain we walk. The contract only links to existing (older) ids, so a cycle is impossible; this is a guard. */
export const MAX_REMIX_DEPTH = 64;

type Row = { id: number; parent_id: number } & Record<string, unknown>;

/**
 * Remix lineage of a level, from the indexed `LevelPublished.parentId` (levels.parent_id):
 *  - `ancestors`: the parent chain, root (original) first, direct parent last
 *  - `children`: direct remixes, oldest first, each with its own direct remix count
 *  - `descendants`: size of the whole remix subtree below this level
 * Ancestors missing from the index (e.g. indexer started late) stop the chain and set `truncated`.
 */
export function remixRoutes(app: FastifyInstance, svc: Services) {
  app.get("/levels/:id/remixes", async (req, reply) => {
    const p = idParamSchema.safeParse(req.params);
    if (!p.success) return badRequest(reply, "invalid id");
    const byId = svc.db.prepare(`${LEVEL_SELECT} WHERE l.id = ?`);
    const self = byId.get(p.data.id) as Row | undefined;
    if (!self) return reply.code(404).send({ error: "level not indexed" });

    const ancestors: Row[] = [];
    const seen = new Set<number>([self.id]);
    let truncated = false;
    let next = Number(self.parent_id);
    while (next > 0) {
      if (seen.has(next) || ancestors.length >= MAX_REMIX_DEPTH) {
        truncated = true;
        break;
      }
      const row = byId.get(next) as Row | undefined;
      if (!row) {
        truncated = true;
        break;
      }
      seen.add(next);
      ancestors.unshift(row);
      next = Number(row.parent_id);
    }

    const children = svc.db
      .prepare(
        `${LEVEL_SELECT.replace("SELECT l.*,", "SELECT l.*, (SELECT COUNT(*) FROM levels c WHERE c.parent_id = l.id) AS remixes,")}
         WHERE l.parent_id = ? ORDER BY l.id ASC`,
      )
      .all(p.data.id);

    // Whole subtree size; parent ids are always older than the child, so the recursion terminates.
    const { n } = svc.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (
           SELECT id FROM levels WHERE parent_id = ?
           UNION SELECT l.id FROM levels l JOIN sub ON l.parent_id = sub.id
         ) SELECT COUNT(*) AS n FROM sub`,
      )
      .get(p.data.id) as { n: number };

    return {
      levelId: p.data.id,
      parentId: Number(self.parent_id),
      ancestors,
      children,
      descendants: n,
      truncated,
    };
  });
}
