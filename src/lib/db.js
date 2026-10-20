// SQLite integrado en Node (node:sqlite), modo WAL, sin dependencias externas.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from './config.js';

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;');

export const now = () => Math.floor(Date.now() / 1000);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const dir = path.join(ROOT, 'db', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  let applied = 0;
  for (const f of files) {
    const v = parseInt(f, 10);
    if (done.has(v)) continue;
    tx(() => {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(v, now());
    });
    applied++;
  }
  return { total: files.length, applied };
}

export function migrationCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
}

export const getState = (key, d = null) => {
  const r = db.prepare('SELECT value FROM worker_state WHERE key = ?').get(key);
  return r ? r.value : d;
};
export const setState = (key, value) =>
  db
    .prepare(
      'INSERT INTO worker_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    )
    .run(key, String(value), now());
