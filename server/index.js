require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { getDb } = require('./db');
const authRoutes = require('./routes/auth');
const playerRoutes = require('./routes/player');
const leaderboardRoutes = require('./routes/leaderboard');
const chatRoutes = require('./routes/chat');
const factionRoutes = require('./routes/factions');
const narrateRoutes = require('./routes/narrate');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

// ── API ROUTES ────────────────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/player',      playerRoutes);
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/chat',        chatRoutes);
app.use('/api/factions',    factionRoutes);

// Faction chat is mounted under chat router but needs faction prefix
const { requireAuth } = require('./auth');
const { getDb: getDbInline } = require('./db');
app.get('/api/factions/:factionId/chat', (req, res) => {
  const db = getDbInline();
  const { factionId } = req.params;
  const messages = db.prepare(`
    SELECT id, name, cls, level, fxp, text, created_at
    FROM faction_chat WHERE faction_id = ?
    ORDER BY created_at DESC LIMIT 40
  `).all(factionId);
  res.json(messages.map(m => ({
    id: m.id, name: m.name, cls: m.cls,
    level: m.level, fxp: m.fxp, text: m.text, ts: m.created_at * 1000,
  })));
});

app.post('/api/factions/:factionId/chat', requireAuth, (req, res) => {
  const db = getDbInline();
  const { factionId } = req.params;
  const { name, cls, level, fxp, text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'empty message' });
  db.prepare(`
    INSERT INTO faction_chat (faction_id, name, cls, level, fxp, text)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(factionId, name, cls, level || 1, fxp || 0, text.slice(0, 140).trim());
  const msgs = db.prepare(`
    SELECT id, name, cls, level, fxp, text, created_at
    FROM faction_chat WHERE faction_id = ?
    ORDER BY created_at DESC LIMIT 40
  `).all(factionId);
  res.json(msgs.map(m => ({
    id: m.id, name: m.name, cls: m.cls,
    level: m.level, fxp: m.fxp, text: m.text, ts: m.created_at * 1000,
  })));
});

app.use('/api/narrate', narrateRoutes);
app.use('/backstage/api', adminRoutes);

// Serve admin panel UI
app.get('/backstage', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ ok: true, mode: 'self-hosted', ts: Date.now() });
});

// ── SERVE FRONTEND ────────────────────────────────────────────────────────────
// After running `npm run build` in /client, static files land in /server/public
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// SPA fallback — all non-API routes serve index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ── START ─────────────────────────────────────────────────────────────────────
// Initialize DB on startup
getDb();

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   NETRUNNER SERVER                    ║
  ║   Running on port ${String(PORT).padEnd(20)}║
  ║   Mode: self-hosted                   ║
  ║   DB: ${(process.env.DB_PATH || './netrunner.db').padEnd(32)}║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
