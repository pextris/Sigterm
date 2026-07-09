const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();

const SEASON_DAYS = parseInt(process.env.SEASON_DAYS || '180');

function scoreValue(entry) {
  return (entry.boss ? 100000 : 0) +
    entry.level * 5000 +
    entry.kills * 200 +
    Math.floor((entry.credits || 0) / 10);
}

function checkSeasonReset(db) {
  const current = db.prepare('SELECT * FROM seasons ORDER BY id DESC LIMIT 1').get();
  if (!current) return;

  const ageInDays = (Date.now() / 1000 - current.started_at) / 86400;
  if (ageInDays < SEASON_DAYS) return;

  // Archive season winner
  const winner = db.prepare(`
    SELECT * FROM leaderboard WHERE season = ? ORDER BY score DESC LIMIT 1
  `).get(current.season);

  db.prepare(`
    UPDATE seasons SET ended_at = unixepoch(), winner_name = ?, winner_cls = ?, winner_score = ?
    WHERE season = ?
  `).run(winner?.name, winner?.cls, winner?.score, current.season);

  // Start new season
  const newSeason = current.season + 1;
  db.prepare('INSERT INTO seasons (season, started_at) VALUES (?, unixepoch())').run(newSeason);

  console.log(`[LB] Season ${current.season} ended. Winner: ${winner?.name}. Season ${newSeason} started.`);
}

// GET /api/leaderboard
router.get('/', (req, res) => {
  const db = getDb();
  checkSeasonReset(db);

  const current = db.prepare('SELECT * FROM seasons ORDER BY id DESC LIMIT 1').get();
  const season = current?.season || 1;

  const entries = db.prepare(`
    SELECT name, cls, level, kills, credits, pvp_wins, boss, perks, score, submitted_at
    FROM leaderboard WHERE season = ?
    ORDER BY score DESC LIMIT 100
  `).all(season);

  const hall = db.prepare(`
    SELECT season, winner_name, winner_cls, winner_score, ended_at
    FROM seasons WHERE ended_at IS NOT NULL
    ORDER BY season DESC LIMIT 5
  `).all();

  res.json({
    entries: entries.map(e => ({
      name: e.name, cls: e.cls, level: e.level, kills: e.kills,
      credits: e.credits, pvpWins: e.pvp_wins, bossDefeated: !!e.boss,
      perks: e.perks, score: e.score, ts: e.submitted_at * 1000,
    })),
    meta: {
      season,
      weekStart: (current?.started_at || 0) * 1000,
    },
    hall: hall.map(h => ({
      season: h.season,
      date: h.ended_at ? new Date(h.ended_at * 1000).toLocaleDateString() : null,
      winners: h.winner_name ? [{
        name: h.winner_name, cls: h.winner_cls,
        level: 0, kills: 0, bossDefeated: false,
      }] : [],
    })),
  });
});

// POST /api/leaderboard/submit
router.post('/submit', requireAuth, (req, res) => {
  const db = getDb();
  checkSeasonReset(db);

  const current = db.prepare('SELECT season FROM seasons ORDER BY id DESC LIMIT 1').get();
  const season = current?.season || 1;

  const { name, cls, level, kills, credits, pvpWins, bossDefeated, perks } = req.body;
  const score = scoreValue({ level, kills, credits, boss: bossDefeated });

  db.prepare(`
    INSERT INTO leaderboard (season, name, cls, level, kills, credits, pvp_wins, boss, perks, score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(season, name, cls) DO UPDATE SET
      level = CASE WHEN excluded.score > score THEN excluded.level ELSE level END,
      kills = CASE WHEN excluded.score > score THEN excluded.kills ELSE kills END,
      credits = CASE WHEN excluded.score > score THEN excluded.credits ELSE credits END,
      pvp_wins = CASE WHEN excluded.score > score THEN excluded.pvp_wins ELSE pvp_wins END,
      boss = CASE WHEN excluded.score > score THEN excluded.boss ELSE boss END,
      perks = CASE WHEN excluded.score > score THEN excluded.perks ELSE perks END,
      score = CASE WHEN excluded.score > score THEN excluded.score ELSE score END,
      submitted_at = CASE WHEN excluded.score > score THEN unixepoch() ELSE submitted_at END
  `).run(season, name, cls, level, kills, credits, pvpWins || 0, bossDefeated ? 1 : 0, perks || 0, score);

  res.json({ ok: true, score });
});

module.exports = router;
