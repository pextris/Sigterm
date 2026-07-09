const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './netrunner.db';

let db;

function getDb() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma('journal_mode = WAL');  // Better concurrent read performance
    db.pragma('foreign_keys = ON');
    migrate();
  }
  return db;
}

function migrate() {
  const db = getDb();

  // ── USERS ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      username    TEXT    UNIQUE NOT NULL COLLATE NOCASE,
      password    TEXT    NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      last_login  INTEGER
    );
  `);

  // ── PLAYERS ────────────────────────────────────────────────────────────────
  // Full player state stored as JSON blob — easy to evolve
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data        TEXT    NOT NULL DEFAULT '{}',
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // ── LEADERBOARD ────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      season      INTEGER NOT NULL DEFAULT 1,
      name        TEXT    NOT NULL,
      cls         TEXT    NOT NULL,
      level       INTEGER NOT NULL DEFAULT 1,
      kills       INTEGER NOT NULL DEFAULT 0,
      credits     INTEGER NOT NULL DEFAULT 0,
      pvp_wins    INTEGER NOT NULL DEFAULT 0,
      boss        INTEGER NOT NULL DEFAULT 0,
      perks       INTEGER NOT NULL DEFAULT 0,
      score       INTEGER NOT NULL DEFAULT 0,
      submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(season, name, cls)
    );

    CREATE INDEX IF NOT EXISTS idx_lb_season_score ON leaderboard(season, score DESC);
  `);

  // ── SEASONS ────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      season      INTEGER UNIQUE NOT NULL,
      started_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at    INTEGER,
      winner_name TEXT,
      winner_cls  TEXT,
      winner_score INTEGER
    );

    INSERT OR IGNORE INTO seasons (season, started_at) VALUES (1, unixepoch());
  `);

  // ── GLOBAL CHAT ────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT    NOT NULL DEFAULT 'player',
      name        TEXT,
      cls         TEXT,
      level       INTEGER,
      text        TEXT    NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat(created_at DESC);
  `);

  // ── FACTION CHAT ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS faction_chat (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      faction_id  TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      cls         TEXT,
      level       INTEGER,
      fxp         INTEGER DEFAULT 0,
      text        TEXT    NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_fchat_faction ON faction_chat(faction_id, created_at DESC);
  `);

  // ── FACTION STANDINGS ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS faction_standings (
      week        INTEGER NOT NULL,
      faction_id  TEXT    NOT NULL,
      total_fxp   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (week, faction_id)
    );
  `);

  console.log('[DB] Migrations complete');
}

module.exports = { getDb };
