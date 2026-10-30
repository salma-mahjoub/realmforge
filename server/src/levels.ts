import type { Hex } from "viem";
import type { Db } from "./db.js";
import { analyzeLevel, type LevelAnalysis } from "./level/analysis.js";
import { levelSchema, type Level } from "./level/schema.js";

export interface PinnedLevel {
  layoutHash: Hex;
  levelCid: string;
  metadataCid: string | null;
  thumbnailCid: string | null;
  minTimeMs: number;
  level: Level;
  analysis: LevelAnalysis;
}

/** Access to levels pinned through this API and to the on-chain id -> layoutHash mapping (indexer). */
export class LevelRepo {
  private cache = new Map<string, PinnedLevel>();
  constructor(private readonly db: Db) {}

  savePinned(p: Omit<PinnedLevel, "analysis" | "minTimeMs"> & { minTimeMs: number; canonicalJson: string }): void {
    this.db
      .prepare(
        `INSERT INTO pinned_levels (layout_hash, level_cid, metadata_cid, thumbnail_cid, min_time_ms, json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(layout_hash) DO UPDATE SET level_cid=excluded.level_cid, metadata_cid=excluded.metadata_cid,
           thumbnail_cid=excluded.thumbnail_cid, min_time_ms=excluded.min_time_ms`,
      )
      .run(p.layoutHash.toLowerCase(), p.levelCid, p.metadataCid, p.thumbnailCid, p.minTimeMs, p.canonicalJson, Date.now());
    this.cache.delete(p.layoutHash.toLowerCase());
  }

  getByHash(hash: string): PinnedLevel | null {
    const key = hash.toLowerCase();
    const cached = this.cache.get(key);
    if (cached) return cached;
    const row = this.db.prepare("SELECT * FROM pinned_levels WHERE layout_hash = ?").get(key) as
      | { layout_hash: string; level_cid: string; metadata_cid: string | null; thumbnail_cid: string | null; min_time_ms: number; json: string }
      | undefined;
    if (!row) return null;
    const level = levelSchema.parse(JSON.parse(row.json));
    const analysis = { ...analyzeLevel(level), minTimeMs: row.min_time_ms };
    const out: PinnedLevel = {
      layoutHash: row.layout_hash as Hex,
      levelCid: row.level_cid,
      metadataCid: row.metadata_cid,
      thumbnailCid: row.thumbnail_cid,
      minTimeMs: row.min_time_ms,
      level,
      analysis,
    };
    this.cache.set(key, out);
    return out;
  }

  /** layoutHash of an on-chain level id (from the indexer), or null. */
  hashForLevelId(levelId: bigint | number): Hex | null {
    const row = this.db.prepare("SELECT layout_hash FROM levels WHERE id = ?").get(Number(levelId)) as { layout_hash: string } | undefined;
    return (row?.layout_hash as Hex) ?? null;
  }

  getByLevelId(levelId: bigint | number): PinnedLevel | null {
    const hash = this.hashForLevelId(levelId);
    return hash ? this.getByHash(hash) : null;
  }

  isPublished(hash: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM levels WHERE layout_hash = ?").get(hash.toLowerCase());
  }
}
