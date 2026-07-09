const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const FACTION_WEEK_MS = 7 * 24 * 3600 * 1000;

function getCurrentWeek(db) {
  // Week number = floor of ms since epoch / week ms
  return Math.floor(Date.now() / FACTION_WEEK_MS);
}

// GET /api/factions
router.get('/', (req, res) => {
  const db = getDb();
  const week = getCurrentWeek(db);

  // Current week totals
  const rows = db.prepare(`
    SELECT faction_id, total_fxp FROM faction_standings WHERE week = ?
  `).all(week);

  const totals = { ghost_protocol: 0, deadlock: 0, cipher_syndicate: 0 };
  for (const row of rows) totals[row.faction_id] = row.total_fxp;

  // Last week winner
  const lastWeek = week - 1;
  const lastRows = db.prepare(`
    SELECT faction_id, total_fxp FROM faction_standings WHERE week = ?
    ORDER BY total_fxp DESC LIMIT 1
  `).get(lastWeek);

  // History (last 5 weeks)
  const history = db.prepare(`
    SELECT week, faction_id, total_fxp FROM faction_standings
    WHERE week < ? ORDER BY week DESC, total_fxp DESC
  `).all(week);

  // Group history by week, take top per week
  const historyMap = {};
  for (const h of history) {
    if (!historyMap[h.week]) historyMap[h.week] = h;
  }

  res.json({
    weekStart: week * FACTION_WEEK_MS,
    week,
    totals,
    lastWinner: lastRows ? { id: lastRows.faction_id, fxp: lastRows.total_fxp, week: lastWeek } : null,
    history: Object.values(historyMap).slice(0, 5).map(h => ({
      id: h.faction_id, fxp: h.total_fxp, week: h.week,
    })),
  });
});

// POST /api/factions/contribute
router.post('/contribute', requireAuth, (req, res) => {
  const db = getDb();
  const { factionId, amount } = req.body;

  if (!factionId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'factionId and positive amount required' });
  }

  const week = getCurrentWeek(db);

  db.prepare(`
    INSERT INTO faction_standings (week, faction_id, total_fxp)
    VALUES (?, ?, ?)
    ON CONFLICT(week, faction_id) DO UPDATE SET
      total_fxp = total_fxp + excluded.total_fxp
  `).run(week, factionId, amount);

  res.json({ ok: true });
});

module.exports = router;
