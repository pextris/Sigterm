/**
 * NETRUNNER — API Adapter
 *
 * MODE 1 (ARTIFACT / LOCAL):
 *   VITE_API_URL is not set. Uses localStorage for player data
 *   and window.storage for shared leaderboard/chat.
 *
 * MODE 2 (SELF-HOSTED):
 *   VITE_API_URL=http://your-server:3000
 *   All data goes through your Express/SQLite backend.
 *   Set this in client/.env
 */

const API_URL = import.meta.env.VITE_API_URL || null;
const IS_SELF_HOSTED = !!API_URL;

// ─── PLAYER ──────────────────────────────────────────────────────────────────

const SAVE_KEY = 'netrunner_v3';

export async function loadPlayer() {
  if (IS_SELF_HOSTED) {
    const token = getToken();
    if (!token) return null;
    const res = await apiFetch('/api/player');
    if (!res.ok) return null;
    return res.json();
  }
  // Artifact mode — localStorage
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function savePlayer(playerData) {
  if (IS_SELF_HOSTED) {
    await apiFetch('/api/player', {
      method: 'POST',
      body: JSON.stringify(playerData),
    });
    return;
  }
  // Artifact mode
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(playerData)); } catch {}
}

export function clearPlayer() {
  if (IS_SELF_HOSTED) {
    clearToken();
    return;
  }
  localStorage.removeItem(SAVE_KEY);
}

// ─── AUTH (self-hosted only) ──────────────────────────────────────────────────

export async function register(username, password, cls) {
  if (!IS_SELF_HOSTED) return { ok: true }; // no-op in artifact mode
  const res = await apiFetch('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, cls }),
  });
  const data = await res.json();
  if (data.token) setToken(data.token);
  return data;
}

export async function login(username, password) {
  if (!IS_SELF_HOSTED) return { ok: true };
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (data.token) setToken(data.token);
  return data;
}

export function isLoggedIn() {
  if (!IS_SELF_HOSTED) return true; // always "logged in" locally
  return !!getToken();
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

export async function fetchLeaderboard() {
  if (IS_SELF_HOSTED) {
    const res = await apiFetch('/api/leaderboard');
    return res.json();
  }
  // Artifact mode — window.storage
  try {
    const r = await window.storage.get('netrunner_leaderboard', true);
    const meta = await window.storage.get('netrunner_lb_meta', true);
    const hall = await window.storage.get('netrunner_hall_of_fame', true);
    return {
      entries: r ? JSON.parse(r.value) : [],
      meta: meta ? JSON.parse(meta.value) : { season: 1, weekStart: Date.now() },
      hall: hall ? JSON.parse(hall.value) : [],
    };
  } catch { return { entries: [], meta: { season: 1 }, hall: [] }; }
}

export async function submitScore(player) {
  const entry = {
    name: player.name,
    cls: player.cls,
    level: player.level,
    kills: player.kills,
    credits: player.credits,
    pvpWins: player.pvpWins || 0,
    bossDefeated: player.bossDefeated || false,
    perks: (player.perks || []).length,
    dungeonTitles: player.dungeonTitles || [],
    ts: Date.now(),
  };

  if (IS_SELF_HOSTED) {
    const res = await apiFetch('/api/leaderboard/submit', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
    return res.json();
  }

  // Artifact mode — replicate existing logic
  try {
    const r = await window.storage.get('netrunner_leaderboard', true);
    const entries = r ? JSON.parse(r.value) : [];
    const scoreValue = (e) =>
      (e.bossDefeated ? 100000 : 0) + e.level * 5000 + e.kills * 200 + Math.floor((e.credits || 0) / 10);
    const filtered = entries.filter(e => !(e.name === entry.name && e.cls === entry.cls));
    const already = entries.find(e => e.name === entry.name && e.cls === entry.cls);
    const final = already && scoreValue(already) >= scoreValue(entry) ? entries : [...filtered, entry];
    const sorted = final.sort((a, b) => scoreValue(b) - scoreValue(a)).slice(0, 100);
    await window.storage.set('netrunner_leaderboard', JSON.stringify(sorted), true);
    return sorted;
  } catch { return []; }
}

// ─── GLOBAL CHAT ─────────────────────────────────────────────────────────────

export async function fetchChat() {
  if (IS_SELF_HOSTED) {
    const res = await apiFetch('/api/chat');
    return res.json();
  }
  try {
    const r = await window.storage.get('netrunner_chat', true);
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}

export async function postChat(player, text) {
  const msg = {
    id: Date.now() + Math.random(),
    type: 'player',
    name: player.name,
    cls: player.cls,
    level: player.level,
    text: text.slice(0, 140),
    ts: Date.now(),
  };

  if (IS_SELF_HOSTED) {
    const res = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify(msg),
    });
    return res.json();
  }

  try {
    const r = await window.storage.get('netrunner_chat', true);
    const messages = r ? JSON.parse(r.value) : [];
    const updated = [msg, ...messages].slice(0, 50);
    await window.storage.set('netrunner_chat', JSON.stringify(updated), true);
    return updated;
  } catch { return []; }
}

export async function postSystemMessage(text) {
  const msg = {
    id: Date.now() + Math.random(),
    type: 'system',
    name: 'GRID',
    text,
    ts: Date.now(),
  };

  if (IS_SELF_HOSTED) {
    await apiFetch('/api/chat/system', { method: 'POST', body: JSON.stringify({ text }) });
    return;
  }

  try {
    const r = await window.storage.get('netrunner_chat', true);
    const messages = r ? JSON.parse(r.value) : [];
    const updated = [msg, ...messages].slice(0, 50);
    await window.storage.set('netrunner_chat', JSON.stringify(updated), true);
  } catch {}
}

// ─── FACTION ─────────────────────────────────────────────────────────────────

export async function fetchFactionData() {
  if (IS_SELF_HOSTED) {
    const res = await apiFetch('/api/factions');
    return res.json();
  }
  try {
    const r = await window.storage.get('netrunner_factions', true);
    const now = Date.now();
    return r ? JSON.parse(r.value) : {
      weekStart: now, week: 1,
      totals: { ghost_protocol: 0, deadlock: 0, cipher_syndicate: 0 },
      lastWinner: null, history: [],
    };
  } catch { return null; }
}

export async function contributeFactionXP(factionId, amount) {
  if (IS_SELF_HOSTED) {
    await apiFetch('/api/factions/contribute', {
      method: 'POST',
      body: JSON.stringify({ factionId, amount }),
    });
    return fetchFactionData();
  }
  try {
    const data = await fetchFactionData();
    if (!data) return null;
    data.totals[factionId] = (data.totals[factionId] || 0) + amount;
    await window.storage.set('netrunner_factions', JSON.stringify(data), true);
    return data;
  } catch { return null; }
}

export async function fetchFactionChat(factionId) {
  if (IS_SELF_HOSTED) {
    const res = await apiFetch(`/api/factions/${factionId}/chat`);
    return res.json();
  }
  try {
    const r = await window.storage.get(`netrunner_faction_chat_${factionId}`, true);
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}

export async function postFactionChat(player, text) {
  const msg = {
    id: Date.now() + Math.random(),
    name: player.name,
    cls: player.cls,
    level: player.level,
    fxp: player.factionXP || 0,
    text: text.slice(0, 140),
    ts: Date.now(),
  };

  if (IS_SELF_HOSTED) {
    const res = await apiFetch(`/api/factions/${player.factionId}/chat`, {
      method: 'POST',
      body: JSON.stringify(msg),
    });
    return res.json();
  }

  try {
    const r = await window.storage.get(`netrunner_faction_chat_${player.factionId}`, true);
    const msgs = r ? JSON.parse(r.value) : [];
    const updated = [msg, ...msgs].slice(0, 40);
    await window.storage.set(`netrunner_faction_chat_${player.factionId}`, JSON.stringify(updated), true);
    return updated;
  } catch { return []; }
}

// ─── NARRATION (Claude API) ───────────────────────────────────────────────────

export async function getNarration(prompt) {
  if (IS_SELF_HOSTED) {
    // In self-hosted mode, the API key stays on the server — never exposed to browser
    const res = await apiFetch('/api/narrate', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    return data.text || '// Signal lost.';
  }

  // Artifact mode — call Claude directly from browser (API key in Anthropic sandbox)
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are the narrator of NETRUNNER, a gritty cyberpunk hacker RPG set in a neon-drenched dystopia.
Write in second person, present tense. Use hacker/cyberpunk slang naturally.
Keep responses to 2-3 sentences max. Be vivid, terse, cinematic.
No markdown, no asterisks. Plain text only.`,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content?.[0]?.text || '// Signal lost.';
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getToken() {
  try { return localStorage.getItem('netrunner_token'); } catch { return null; }
}

function setToken(t) {
  try { localStorage.setItem('netrunner_token', t); } catch {}
}

function clearToken() {
  try { localStorage.removeItem('netrunner_token'); } catch {}
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
}

export const IS_ARTIFACT_MODE = !IS_SELF_HOSTED;
