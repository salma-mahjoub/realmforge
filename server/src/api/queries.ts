/** Level name/theme from the pinned JSON (null when the level was not pinned through this server). */
export const META_COLS = "json_extract(p.json, '$.meta.name') AS name, json_extract(p.json, '$.meta.theme') AS theme";

/** Level row + pinned-file columns, the shape the web app maps with `rowToSummary`. Append a WHERE clause. */
export const LEVEL_SELECT = `SELECT l.*, p.level_cid, p.metadata_cid, p.thumbnail_cid, p.min_time_ms, ${META_COLS}
  FROM levels l LEFT JOIN pinned_levels p ON p.layout_hash = l.layout_hash`;
