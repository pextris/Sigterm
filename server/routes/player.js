const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

// GET /api/player — load player state
router.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT data FROM players WHERE user_id = ?').get(req.userId);
  if (!row) return res.status(404).json({ error: 'Player not found' });
  res.json(JSON.parse(row.data));
});

// POST /api/player — save player state
router.post('/', requireAuth, (req, res) => {
  const db = getDb();
  const data = JSON.stringify(req.body);
  db.prepare(`
    INSERT INTO players (user_id, data, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(user_id) DO UPDATE SET
      data = excluded.data,
      updated_at = excluded.updated_at
  `).run(req.userId, data);
  res.json({ ok: true });
});

module.exports = router;
