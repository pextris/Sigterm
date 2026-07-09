const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const CHAT_MAX = 50;
const CHAT_MAX_LEN = 140;
const FACTION_CHAT_MAX = 40;

// ── GLOBAL CHAT ──────────────────────────────────────────────────────────────

// GET /api/chat
router.get('/', (req, res) => {
  const db = getDb();
  const messages = db.prepare(`
    SELECT id, type, name, cls, level, text, created_at
    FROM chat ORDER BY created_at DESC LIMIT ?
  `).all(CHAT_MAX);

  res.json(messages.map(m => ({
    id: m.id,
    type: m.type,
    name: m.name,
    cls: m.cls,
    level: m.level,
    text: m.text,
    ts: m.created_at * 1000,
  })));
});

// POST /api/chat — player message
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const { name, cls, level, text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  db.prepare(`
    INSERT INTO chat (type, name, cls, level, text)
    VALUES ('player', ?, ?, ?, ?)
  `).run(name, cls, level || 1, text.slice(0, CHAT_MAX_LEN).trim());

  // Return latest messages
  const messages = db.prepare(`
    SELECT id, type, name, cls, level, text, created_at
    FROM chat ORDER BY created_at DESC LIMIT ?
  `).all(CHAT_MAX);

  res.json(messages.map(m => ({
    id: m.id, type: m.type, name: m.name,
    cls: m.cls, level: m.level, text: m.text, ts: m.created_at * 1000,
  })));
});

// POST /api/chat/system — system event message (internal, no auth required from client)
// Called server-side when events happen (boss kills, rank ups, etc.)
router.post('/system', requireAuth, (req, res) => {
  const db = getDb();
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  db.prepare(`
    INSERT INTO chat (type, name, text) VALUES ('system', 'GRID', ?)
  `).run(text.slice(0, 200));

  res.json({ ok: true });
});

// ── FACTION CHAT ─────────────────────────────────────────────────────────────

// GET /api/factions/:factionId/chat
router.get('/factions/:factionId/chat', (req, res) => {
  const db = getDb();
  const { factionId } = req.params;

  const messages = db.prepare(`
    SELECT id, name, cls, level, fxp, text, created_at
    FROM faction_chat WHERE faction_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(factionId, FACTION_CHAT_MAX);

  res.json(messages.map(m => ({
    id: m.id, name: m.name, cls: m.cls,
    level: m.level, fxp: m.fxp, text: m.text, ts: m.created_at * 1000,
  })));
});

// POST /api/factions/:factionId/chat
router.post('/factions/:factionId/chat', requireAuth, (req, res) => {
  const db = getDb();
  const { factionId } = req.params;
  const { name, cls, level, fxp, text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Message cannot be empty' });
  }

  db.prepare(`
    INSERT INTO faction_chat (faction_id, name, cls, level, fxp, text)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(factionId, name, cls, level || 1, fxp || 0, text.slice(0, CHAT_MAX_LEN).trim());

  const messages = db.prepare(`
    SELECT id, name, cls, level, fxp, text, created_at
    FROM faction_chat WHERE faction_id = ?
    ORDER BY created_at DESC LIMIT ?
  `).all(factionId, FACTION_CHAT_MAX);

  res.json(messages.map(m => ({
    id: m.id, name: m.name, cls: m.cls,
    level: m.level, fxp: m.fxp, text: m.text, ts: m.created_at * 1000,
  })));
});

module.exports = router;
