import type { Db } from "../db.js";
import { tx } from "../db.js";

/** Minimal decoded-log shape (what viem returns for watchContractEvent/getContractEvents). */
export interface DecodedLog {
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint | null;
  transactionHash: string | null;
  logIndex: number | null;
  /** Emitting contract (viem sets it on every log); used to recognise FORGE leaving ForgeCoin's own balance. */
  address?: string | null;
}

const lc = (v: unknown) => String(v).toLowerCase();
const s = (v: unknown) => (typeof v === "bigint" ? v.toString() : String(v));
const n = (v: unknown) => Number(v);

/** Race payout split of ForgeCoin.settleRace (basis points of the pot): 1st 60%, 2nd 25%, owner 10%, pool 5%. */
const RACE_OWNER_BPS = 1_000n;
const RACE_FIRST_BPS = 6_000n;
const RACE_SECOND_BPS = 2_500n;
const BPS = 10_000n;

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

    const logIndex = log.logIndex!;
    const now = Date.now();
    /** One row of the per-level activity feed (the UI shows kind + tx link + how long ago). */
    const feed = (levelId: unknown, kind: string, actor: unknown) =>
      db
        .prepare("INSERT OR IGNORE INTO activity (level_id, kind, actor, block_number, tx_hash, log_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(n(levelId), kind, actor == null ? null : lc(actor), block, txHash, logIndex, now);

    switch (log.eventName) {
      // ---------------- LevelNFT (SPEC §4.3) ----------------
      case "LevelPublished":
        db.prepare(
          `INSERT INTO levels (id, creator, owner, layout_hash, parent_id, play_fee, block_number, tx_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET creator=excluded.creator, layout_hash=excluded.layout_hash,
             parent_id=excluded.parent_id, play_fee=excluded.play_fee`,
        ).run(n(a.id), lc(a.creator), lc(a.creator), lc(a.layoutHash), n(a.parentId ?? 0), s(a.playFee ?? 0), block, txHash, now);
        feed(a.id, "Published", a.creator);
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
        feed(a.id, "Listed", null);
        break;
      case "Unlisted":
        db.prepare("UPDATE levels SET listing_price = NULL WHERE id = ?").run(n(a.id));
        break;
      case "Sold":
        db.prepare(
          "INSERT OR IGNORE INTO sales (level_id, seller, buyer, price, block_number, tx_hash, log_index) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(n(a.id), lc(a.from), lc(a.to), s(a.price), block, txHash, log.logIndex!);
        db.prepare("UPDATE levels SET owner = ?, listing_price = NULL WHERE id = ?").run(lc(a.to), n(a.id));
        feed(a.id, "Sold", a.to);
        break;
      case "Transfer":
        // ERC-20 Transfer shares topic0 with ERC-721 Transfer; only the 721 one has `tokenId`.
        if (a.tokenId === undefined) {
          // ERC-20: remember FORGE paid out of ForgeCoin's own balance in this tx (closeSeason pays winners this way,
          // and SeasonClosed is emitted after its transfers). Older txs' rows are dropped so the table stays tiny.
          if (log.address && lc(a.from) === lc(log.address)) {
            db.prepare("DELETE FROM forge_outflows WHERE tx_hash != ?").run(txHash);
            db.prepare("INSERT OR IGNORE INTO forge_outflows (tx_hash, log_index, recipient, amount) VALUES (?, ?, ?, ?)").run(txHash, logIndex, lc(a.to), s(a.value));
          }
          break;
        }
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
        feed(a.id, "New record", a.player);
        break;

      // ---------------- ForgeCoin (SPEC §5.4) ----------------
      case "RunSettled":
        db.prepare(
          `INSERT INTO runs (level_id, player, time_ms, cleared, reward, fee_paid, block_number, tx_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(tx_hash, level_id, player) DO UPDATE SET reward=excluded.reward, fee_paid=excluded.fee_paid`,
        ).run(n(a.levelId), lc(a.player), n(a.timeMs), a.cleared ? 1 : 0, s(a.reward), s(a.feePaid), block, txHash);
        feed(a.levelId, a.cleared ? "Clear" : "Play fee", a.player);
        break;
      case "FeeSplit":
        // The level owner's 70% of a play fee (what "creator earnings" means: the owner at that time is paid).
        db.prepare(
          `INSERT OR IGNORE INTO fee_splits (level_id, source, owner, owner_amt, pool_amt, treasury_amt, block_number, tx_hash, log_index, created_at)
           VALUES (?, 'run', ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(n(a.levelId), lc(a.owner), s(a.ownerAmt), s(a.poolAmt), s(a.treasuryAmt), block, txHash, logIndex, now);
        break;
      case "FeeBurned":
        // Emitted right after FeeSplit in the same transaction: attach the burned amount to that row.
        db.prepare("UPDATE fee_splits SET burned_amt = ? WHERE tx_hash = ? AND level_id = ? AND source = 'run'").run(s(a.amount), txHash, n(a.levelId));
        break;
      case "SeasonClosed":
        db.prepare("INSERT OR IGNORE INTO seasons (season, pool, block_number, tx_hash, closed_at) VALUES (?, ?, ?, ?, ?)").run(n(a.season), s(a.pool), block, txHash, now);
        db.prepare(
          `INSERT OR IGNORE INTO season_payouts (season, position, recipient, amount)
           SELECT ?, ROW_NUMBER() OVER (ORDER BY log_index), recipient, amount FROM forge_outflows WHERE tx_hash = ?`,
        ).run(n(a.season), txHash);
        db.prepare("DELETE FROM forge_outflows WHERE tx_hash = ?").run(txHash);
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
      case "RaceSettled": {
        // The level owner's 10% of the pot and the 5% season-pool share are not events of their own: derive them.
        if (typeof a.pot === "bigint") {
          const race = db.prepare("SELECT level_id FROM races WHERE room_id = ?").get(lc(a.roomId)) as { level_id: number | null } | undefined;
          const lvl = race?.level_id != null ? (db.prepare("SELECT owner FROM levels WHERE id = ?").get(race.level_id) as { owner: string } | undefined) : undefined;
          if (race?.level_id != null && lvl) {
            const ownerAmt = (a.pot * RACE_OWNER_BPS) / BPS;
            const poolAmt = a.pot - (a.pot * RACE_FIRST_BPS) / BPS - (a.pot * RACE_SECOND_BPS) / BPS - ownerAmt;
            db.prepare(
              `INSERT OR IGNORE INTO fee_splits (level_id, source, owner, owner_amt, pool_amt, treasury_amt, block_number, tx_hash, log_index, created_at)
               VALUES (?, 'race', ?, ?, ?, '0', ?, ?, ?, ?)`,
            ).run(race.level_id, lvl.owner, ownerAmt.toString(), poolAmt.toString(), block, txHash, logIndex, now);
          }
        }
        // Contract emits (roomId, first, second, pot); older drafts emitted (roomId, ranking[]).
        db.prepare("UPDATE races SET status = 'settled', ranking = ?, updated_block = ? WHERE room_id = ?").run(
          JSON.stringify(
            (Array.isArray(a.ranking) ? (a.ranking as string[]) : [a.first, a.second].filter((x) => x && !/^0x0{40}$/i.test(String(x)))).map(lc),
          ),
          block,
          lc(a.roomId),
        );
        break;
      }
      case "RaceRefunded":
        db.prepare("UPDATE races SET status = 'refunded', updated_block = ? WHERE room_id = ?").run(block, lc(a.roomId));
        break;
      case "BadgeClaimed":
        db.prepare("INSERT OR IGNORE INTO badge_claims (holder, badge_id, ref, tx_hash) VALUES (?, ?, ?, ?)")
          .run(lc(a.holder), n(a.badgeId), s(a.ref), txHash);
        break;
      default:
        // FaucetClaimed, Race*, SignerUpdated, ... : recorded as processed only.
        break;
    }
    return true;
  });
}
