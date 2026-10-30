import type { Db } from "../db.js";
import { tx } from "../db.js";

/** Minimal decoded-log shape (what viem returns for watchContractEvent/getContractEvents). */
export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint | null;
  transactionHash: string | null;
  logIndex: number | null;
}

const lc = (v: unknown) => String(v).toLowerCase();
const s = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v));
const n = (v: unknown) => Number(v);

/**
 * Apply one decoded event to the database. Idempotent: each (tx, logIndex) is
 * processed once, so backfill + live watch overlap is harmless.
 * Returns false when the log was already processed or is pending (no tx hash).
 */
export function applyLog(db: Db, log: DecodedLog): boolean {
  if (log.transactionHash == null || log.logIndex == null) return false;
  const txHash = log.transactionHash;
  const block = Number(log.blockNumber ?? 0n);
  const a = log.args;

  return tx(db, () => {
    const seen = db
      .prepare("INSERT OR IGNORE INTO processed_logs (tx_hash, log_index) VALUES (?, ?)")
      .run(txHash, log.logIndex!);
    if (seen.changes === 0) return false;

    switch (log.eventName) {
      // ---------------- LevelNFT (SPEC §4.3) ----------------
      case "LevelPublished":
        db.prepare(
          `INSERT INTO levels (id, creator, owner, layout_hash, parent_id, play_fee, block_number, tx_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET creator=excluded.creator, layout_hash=excluded.layout_hash,
             parent_id=excluded.parent_id, play_fee=excluded.play_fee`,
        ).run(n(a.id), lc(a.creator), lc(a.creator), lc(a.layoutHash), n(a.parentId ?? 0), s(a.playFee ?? 0), block, txHash, Date.now());
        break;
      case "PlayFeeUpdated":
        db.prepare("UPDATE levels SET play_fee = ? WHERE id = ?").run(s(a.fee), n(a.id));
        break;
      case "LevelToggled":
        db.prepare("UPDATE levels SET active = ? WHERE id = ?").run(a.active ? 1 : 0, n(a.id));
        break;
      case "Liked":
        db.prepare("UPDATE levels SET likes = likes + 1 WHERE id = ?").run(n(a.id));
        break;
      case "Listed":
        db.prepare("UPDATE levels SET listing_price = ? WHERE id = ?").run(s(a.price), n(a.id));
        break;
      case "Unlisted":
        db.prepare("UPDATE levels SET listing_price = NULL WHERE id = ?").run(n(a.id));
        break;
      case "Sold":
        db.prepare(
          "INSERT OR IGNORE INTO sales (level_id, seller, buyer, price, block_number, tx_hash, log_index) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(n(a.id), lc(a.from), lc(a.to), s(a.price), block, txHash, log.logIndex!);
        db.prepare("UPDATE levels SET owner = ?, listing_price = NULL WHERE id = ?").run(lc(a.to), n(a.id));
        break;
      case "Transfer":
        // ERC-20 Transfer shares topic0 with ERC-721 Transfer; only the 721 one has `tokenId`.
        if (a.tokenId === undefined) break;
        // ERC-721 transfer keeps `owner` current (also clears listing, mirroring the contract's _update override).
        db.prepare("UPDATE levels SET owner = ?, listing_price = NULL WHERE id = ?").run(lc(a.to), n(a.tokenId));
        break;
      case "RunRecorded": {
        const r = db
          .prepare(
            `INSERT INTO runs (level_id, player, time_ms, cleared, block_number, tx_hash) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(tx_hash, level_id, player) DO UPDATE SET time_ms=excluded.time_ms, cleared=excluded.cleared`,
          )
          .run(n(a.id), lc(a.player), n(a.timeMs), a.cleared ? 1 : 0, block, txHash);
        if (r.changes > 0) {
          db.prepare("UPDATE levels SET plays = plays + 1, clears = clears + ? WHERE id = ?").run(a.cleared ? 1 : 0, n(a.id));
        }
        break;
      }
      case "NewRecord":
        db.prepare("UPDATE levels SET best_time_ms = ?, best_player = ? WHERE id = ?").run(n(a.timeMs), lc(a.player), n(a.id));
        break;

      // ---------------- ForgeCoin (SPEC §5.4) ----------------
      case "RunSettled":
        db.prepare(
          `INSERT INTO runs (level_id, player, time_ms, cleared, reward, fee_paid, block_number, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tx_hash, level_id, player) DO UPDATE SET reward=excluded.reward, fee_paid=excluded.fee_paid`,
        ).run(n(a.levelId), lc(a.player), n(a.timeMs), a.cleared ? 1 : 0, s(a.reward), s(a.feePaid), block, txHash);
        break;
      case "RaceCreated":
        db.prepare(
          `INSERT INTO races (room_id, level_id, stake, status, players, updated_block) VALUES (?, ?, ?, 'open', ?, ?)
           ON CONFLICT(room_id) DO NOTHING`,
        ).run(lc(a.roomId), n(a.levelId), s(a.stake), JSON.stringify(a.creator ? [lc(a.creator)] : []), block);
        break;
      case "RaceJoined": {
        const row = db.prepare("SELECT players FROM races WHERE room_id = ?").get(lc(a.roomId)) as { players: string } | undefined;
        if (row) {
          const players = new Set<string>(JSON.parse(row.players));
          players.add(lc(a.player));
          db.prepare("UPDATE races SET players = ?, updated_block = ? WHERE room_id = ?").run(JSON.stringify([...players]), block, lc(a.roomId));
        }
        break;
      }
      case "RaceSettled":
        // Contract emits (roomId, first, second, pot); older drafts emitted (roomId, ranking[]).
        db.prepare("UPDATE races SET status = 'settled', ranking = ?, updated_block = ? WHERE room_id = ?").run(
          JSON.stringify(
            (Array.isArray(a.ranking) ? (a.ranking as string[]) : [a.first, a.second].filter((x) => x && !/^0x0{40}$/i.test(String(x)))).map(lc),
          ),
          block,
          lc(a.roomId),
        );
        break;
      case "RaceRefunded":
        db.prepare("UPDATE races SET status = 'refunded', updated_block = ? WHERE room_id = ?").run(block, lc(a.roomId));
        break;
      default:
        // FaucetClaimed, FeeSplit, SeasonClosed, ... : recorded as processed only.
        break;
    }
    return true;
  });
}
