const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../db');
const { signToken } = require('../auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password, cls } = req.body;

  if (!username || !password || !cls) {
    return res.status(400).json({ error: 'username, password and cls required' });
  }
  if (username.length < 2 || username.length > 20) {
    return res.status(400).json({ error: 'Handle must be 2-20 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = getDb();

  // Check username taken
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(409).json({ error: 'That handle is already taken' });
  }

  const hash = await bcrypt.hash(password, 10);
  const result = db.prepare(
    'INSERT INTO users (username, password, last_login) VALUES (?, ?, unixepoch())'
  ).run(username, hash);

  const userId = result.lastInsertRowid;

  // Create default player state
  const defaultPlayer = {
    name: username,
    cls,
    hp: 100, maxHp: 100,
    atk: 12, def: 6,
    level: 1, xp: 0, credits: 150,
    gear: [], turnsLeft: 10,
    lastReset: new Date().toDateString(),
    kills: 0, bossDefeated: false,
    abilityCooldown: 0,
    statusEffects: [],
    nextFightBuff: null,
    safeModeUntil: null,
    lyraFlirtCount: 0,
    scoutedEnemy: null,
    pvpWins: 0, pvpLosses: 0,
    bounties: [],
    runners: null,
    perks: [],
    perkPoints: 0,
    _rampageAtk: 0,
    inventory: [],
    combatEffects: [],
    quests: [],
    questStats: {},
    factionId: null,
    factionXP: 0,
    factionJoinedAt: null,
    loginStreak: 1,
    longestStreak: 1,
    lastLoginDate: new Date().toDateString(),
    loginHistory: [new Date().toDateString()],
    badges: [],
    dungeonTitles: [],
    dungeonsCleared: [],
  };

  db.prepare('INSERT INTO players (user_id, data) VALUES (?, ?)').run(userId, JSON.stringify(defaultPlayer));

  const token = signToken(userId);
  res.json({ token, player: defaultPlayer });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(401).json({ error: 'Invalid handle or password' });
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid handle or password' });
  }

  db.prepare('UPDATE users SET last_login = unixepoch() WHERE id = ?').run(user.id);

  const token = signToken(user.id);
  const playerRow = db.prepare('SELECT data FROM players WHERE user_id = ?').get(user.id);
  const player = playerRow ? JSON.parse(playerRow.data) : null;

  // Check if banned
  if (player?.banned) {
    return res.status(403).json({ error: 'This account has been suspended.' });
  }

  res.json({ token, player });
});

module.exports = router;
