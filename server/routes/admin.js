/**
 * NETRUNNER — Admin Routes
 * Mounted at /admin
 * Protected by ADMIN_PASSWORD in .env
 * Never expose this route publicly without a strong password
 */

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// ── ADMIN AUTH MIDDLEWARE ─────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null;

function requireAdmin(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin not configured. Set ADMIN_PASSWORD in .env' });
  }
  const auth = req.headers['x-admin-password'] || req.query.password;
  if (auth !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── STATS ─────────────────────────────────────────────────────────────────────

// GET /admin/stats
router.get('/stats', requireAdmin, (req, res) => {
  const db = getDb();

  const totalPlayers = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const activeToday = db.prepare(`
    SELECT COUNT(*) as n FROM players
    WHERE json_extract(data, '$.lastLoginDate') = ?
  `).get(new Date().toDateString()).n;
  const activeWeek = db.prepare(`
    SELECT COUNT(*) as n FROM users
    WHERE last_login > unixepoch() - 604800
  `).get().n;
  const totalMessages = db.prepare('SELECT COUNT(*) as n FROM chat').get().n;
  const totalSeason = db.prepare(
    'SELECT season FROM seasons ORDER BY id DESC LIMIT 1'
  ).get()?.season || 1;
  const dbPath = process.env.DB_PATH || './netrunner.db';
  let dbSize = 0;
  try {
    const fs = require('fs');
    dbSize = fs.statSync(require('path').resolve(dbPath)).size;
  } catch {}

  res.json({
    totalPlayers,
    activeToday,
    activeWeek,
    totalMessages,
    currentSeason: totalSeason,
    dbSizeKb: Math.round(dbSize / 1024),
    uptime: Math.floor(process.uptime()),
    nodeVersion: process.version,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    ts: Date.now(),
  });
});

// ── PLAYERS ──────────────────────────────────────────────────────────────────

// GET /admin/players
router.get('/players', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT u.id, u.username, u.created_at, u.last_login,
           p.data, p.updated_at
    FROM users u
    LEFT JOIN players p ON p.user_id = u.id
    ORDER BY u.last_login DESC NULLS LAST
    LIMIT 200
  `).all();

  const players = rows.map(row => {
    let data = {};
    try { data = JSON.parse(row.data || '{}'); } catch {}
    return {
      id: row.id,
      username: row.username,
      createdAt: row.created_at,
      lastLogin: row.last_login,
      level: data.level || 1,
      cls: data.cls || '?',
      credits: data.credits || 0,
      kills: data.kills || 0,
      bossDefeated: data.bossDefeated || false,
      loginStreak: data.loginStreak || 0,
      factionId: data.factionId || null,
      rep: data.rep || 0,
      banned: data.banned || false,
    };
  });

  res.json(players);
});

// POST /admin/players/:id/ban
router.post('/players/:id/ban', requireAdmin, (req, res) => {
  const db = getDb();
  const player = db.prepare('SELECT data FROM players WHERE user_id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const data = JSON.parse(player.data);
  data.banned = true;
  db.prepare('UPDATE players SET data = ? WHERE user_id = ?')
    .run(JSON.stringify(data), req.params.id);
  res.json({ ok: true, message: `Player ${req.params.id} banned` });
});

// POST /admin/players/:id/unban
router.post('/players/:id/unban', requireAdmin, (req, res) => {
  const db = getDb();
  const player = db.prepare('SELECT data FROM players WHERE user_id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  const data = JSON.parse(player.data);
  data.banned = false;
  db.prepare('UPDATE players SET data = ? WHERE user_id = ?')
    .run(JSON.stringify(data), req.params.id);
  res.json({ ok: true, message: `Player ${req.params.id} unbanned` });
});

// POST /admin/players/:id/reset
router.post('/players/:id/reset', requireAdmin, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Player not found' });
  // Wipe player data but keep the account
  db.prepare('DELETE FROM players WHERE user_id = ?').run(req.params.id);
  res.json({ ok: true, message: `Player ${user.username} save data reset` });
});

// POST /admin/players/:id/give
// Body: { credits, xp }
router.post('/players/:id/give', requireAdmin, (req, res) => {
  const db = getDb();
  const { credits = 0, xp = 0 } = req.body;
  const row = db.prepare('SELECT data FROM players WHERE user_id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Player not found' });
  const data = JSON.parse(row.data);
  if (credits) data.credits = (data.credits || 0) + parseInt(credits);
  if (xp)      data.xp      = (data.xp || 0) + parseInt(xp);
  db.prepare('UPDATE players SET data = ? WHERE user_id = ?')
    .run(JSON.stringify(data), req.params.id);
  res.json({ ok: true, newCredits: data.credits, newXp: data.xp });
});

// ── LEADERBOARD ───────────────────────────────────────────────────────────────

// POST /admin/leaderboard/reset-season
router.post('/leaderboard/reset-season', requireAdmin, (req, res) => {
  const db = getDb();
  const current = db.prepare('SELECT * FROM seasons ORDER BY id DESC LIMIT 1').get();
  const winner = db.prepare(
    'SELECT * FROM leaderboard WHERE season = ? ORDER BY score DESC LIMIT 1'
  ).get(current?.season);

  if (current) {
    db.prepare(`UPDATE seasons SET ended_at = unixepoch(), winner_name = ?, winner_cls = ?, winner_score = ? WHERE season = ?`)
      .run(winner?.name, winner?.cls, winner?.score, current.season);
  }

  const newSeason = (current?.season || 0) + 1;
  db.prepare('INSERT INTO seasons (season, started_at) VALUES (?, unixepoch())').run(newSeason);

  res.json({ ok: true, newSeason, previousWinner: winner?.name || 'none' });
});

// POST /admin/leaderboard/remove
// Body: { name, cls }
router.post('/leaderboard/remove', requireAdmin, (req, res) => {
  const db = getDb();
  const { name, cls } = req.body;
  const current = db.prepare('SELECT season FROM seasons ORDER BY id DESC LIMIT 1').get();
  db.prepare('DELETE FROM leaderboard WHERE season = ? AND name = ? AND cls = ?')
    .run(current?.season, name, cls);
  res.json({ ok: true });
});

// ── BROADCAST ────────────────────────────────────────────────────────────────

// POST /admin/broadcast
// Body: { text }
router.post('/broadcast', requireAdmin, (req, res) => {
  const db = getDb();
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });

  db.prepare(`
    INSERT INTO chat (type, name, text) VALUES ('system', '[GRID ADMIN]', ?)
  `).run(text.slice(0, 280).trim());

  res.json({ ok: true, message: 'Broadcast sent to Dead Drop' });
});

// ── CHAT MODERATION ──────────────────────────────────────────────────────────

// DELETE /admin/chat/:id
router.delete('/chat/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM chat WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /admin/chat/recent
router.get('/chat/recent', requireAdmin, (req, res) => {
  const db = getDb();
  const messages = db.prepare(`
    SELECT id, type, name, cls, text, created_at
    FROM chat ORDER BY created_at DESC LIMIT 50
  `).all();
  res.json(messages);
});

module.exports = router;
