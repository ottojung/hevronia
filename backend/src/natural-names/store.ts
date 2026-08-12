import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_NATURAL_NAMES_DB_PATH = fileURLToPath(
  new URL("../../.data/natural-names.sqlite", import.meta.url),
);

/**
 * The properties that this class carries are:
 * - `assignIfAbsent` returns the name that is now stored for the Telegram
 *   user: the proposed name when none was stored before, or the already
 *   persisted name when a concurrent proposal won.
 * - `getMany` returns at most one name per requested Telegram user id.
 *
 * The proof of those properties is guaranteed by:
 * - The SQLite `INSERT OR IGNORE` upsert only inserts when the primary key is
 *   absent, and the follow-up `SELECT` reads whatever row now exists, so a
 *   race between competing proposals still yields exactly one stable value.
 */
export interface NaturalNameStore {
  assignIfAbsent(userId: number, name: string): Promise<string>;
  get(userId: number): Promise<string | undefined>;
  getMany(userIds: readonly number[]): Promise<ReadonlyMap<number, string>>;
  close(): Promise<void>;
}

export function createNaturalNameStore(dbPath: string): NaturalNameStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(
    "CREATE TABLE IF NOT EXISTS natural_names (user_id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
  );
  const upsert = db.prepare("INSERT OR IGNORE INTO natural_names (user_id, name) VALUES (?, ?)");
  const selectOne = db.prepare("SELECT name FROM natural_names WHERE user_id = ?");
  const selectMany = db.prepare("SELECT user_id, name FROM natural_names WHERE user_id = ?");
  return {
    async assignIfAbsent(userId: number, name: string): Promise<string> {
      upsert.run(userId, name);
      const row = selectOne.get(userId) as { name: string } | undefined;
      if (row === undefined) return name;
      return row.name;
    },
    async get(userId: number): Promise<string | undefined> {
      const row = selectOne.get(userId) as { name: string } | undefined;
      return row?.name;
    },
    async getMany(userIds: readonly number[]): Promise<ReadonlyMap<number, string>> {
      const result = new Map<number, string>();
      for (const userId of userIds) {
        const row = selectMany.get(userId) as { user_id: number; name: string } | undefined;
        if (row !== undefined) result.set(row.user_id, row.name);
      }
      return result;
    },
    async close(): Promise<void> {
      db.close();
    },
  };
}
