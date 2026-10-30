import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * SQLite storage (Node's built-in `node:sqlite`, no native build step).
 * Tables:
 *  - levels       : indexed from LevelNFT events (LevelPublished, PlayFeeUpdated, ...)
 *  - runs         : indexed RunRecorded (LevelNFT) + RunSettled (ForgeCoin)
 *  - sales        : indexed Sold events
 *  - races        : indexed Race* events
 *  - pinned_levels: level JSON pinned through this API (+ min time computed at publish)
 *  - signed_runs  : RunResults signed by this server (replay storage for ghost races)
 *  - processed_logs / indexer_state : idempotent, resumable indexing
 */
export type Db = DatabaseSync;

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS levels (
  id            INTEGER PRIMARY KEY,
  creator       TEXT NOT NULL,
  owner         TEXT NOT NULL,
  layout_hash   TEXT NOT NULL UNIQUE,
  parent_id     INTEGER NOT NULL DEFAULT 0,
  play_fee      TEXT NOT NULL DEFAULT '0',
  active        INTEGER NOT NULL DEFAULT 1,
  plays         INTEGER NOT NULL DEFAULT 0,
  clears        INTEGER NOT NULL DEFAULT 0,
  likes         INTEGER NOT NULL DEFAULT 0,
  best_time_ms  INTEGER,
  best_player   TEXT,
  listing_price TEXT,
  block_number  INTEGER NOT NULL,
  tx_hash       TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS levels_creator ON levels(creator);
CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id     INTEGER NOT NULL,
  player       TEXT NOT NULL,
  time_ms      INTEGER NOT NULL,
  cleared      INTEGER NOT NULL,
  reward       TEXT,
  fee_paid     TEXT,
  block_number INTEGER NOT NULL,
  tx_hash      TEXT NOT NULL,
  UNIQUE (tx_hash, level_id, player)
);
CREATE INDEX IF NOT EXISTS runs_level_time ON runs(level_id, cleared, time_ms);
CREATE TABLE IF NOT EXISTS sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level_id     INTEGER NOT NULL,
  seller       TEXT NOT NULL,
  buyer        TEXT NOT NULL,
  price        TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  tx_hash      TEXT NOT NULL,
  log_index    INTEGER NOT NULL,
  UNIQUE (tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS races (
  room_id      TEXT PRIMARY KEY,
  level_id     INTEGER,
  stake        TEXT,
  status       TEXT NOT NULL,
  players      TEXT NOT NULL DEFAULT '[]',
  ranking      TEXT,
  updated_block INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pinned_levels (
  layout_hash  TEXT PRIMARY KEY,
  level_cid    TEXT NOT NULL,
  metadata_cid TEXT,
  thumbnail_cid TEXT,
  min_time_ms  INTEGER NOT NULL,
  json         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS signed_runs (
  nonce        TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  player       TEXT NOT NULL,
  level_id     TEXT,
  layout_hash  TEXT,
  time_ms      INTEGER NOT NULL,
  cleared      INTEGER NOT NULL,
  coins        INTEGER NOT NULL,
  input_log    TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signed_runs_level ON signed_runs(level_id, cleared, time_ms);
CREATE TABLE IF NOT EXISTS processed_logs (
  tx_hash   TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE TABLE IF NOT EXISTS indexer_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside a transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
