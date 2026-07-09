import React, { useState, useEffect, useRef } from "react";
import {
  loadPlayer, savePlayer, clearPlayer,
  register, login, IS_ARTIFACT_MODE,
} from './api.js';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const CLASSES = {
  netrunner: {
    name: "Netrunner", desc: "Balanced hacker. Strong exploits, moderate trace resistance.",
    hp: 100, atk: 12, def: 6, icon: "[NR]", color: "#55ff55", critChance: 0.15,
    ability: {
      name: "Zero-Day Exploit", desc: "Deploy an unpatched vulnerability. Deals 3x ATK, ignores DEF.",
      cooldown: 3, color: "#55ff55",
      use: (p) => { const dmg = calcAtk(p) * 3; return { dmg, log: `[ZERO-DAY] Unpatched exploit hits for ${dmg} -- DEF bypassed!`, statusToEnemy: null }; }
    }
  },
  ghost: {
    name: "Ghost", desc: "Stealth specialist. Hard to trace, high crit rate.",
    hp: 80, atk: 9, def: 10, icon: "[GH]", color: "#ff55ff", critChance: 0.30,
    ability: {
      name: "Smoke & Mirrors", desc: "Vanish from targeting. Apply TRACED to enemy (-4 DEF) for 3 turns.",
      cooldown: 3, color: "#ff55ff",
      use: (p, e) => ({ dmg: 0, log: `[GHOST] Signal masked. ${e.name} is TRACED -- DEF reduced for 3 turns.`, statusToEnemy: { type: "traced", turns: 3, value: 4 } })
    }
  },
  bruteforcer: {
    name: "Bruteforcer", desc: "Raw power. Hits hard, applies BURN on crit.",
    hp: 130, atk: 16, def: 3, icon: "[BF]", color: "#ffff55", critChance: 0.20,
    ability: {
      name: "Packet Flood", desc: "Overwhelm with raw traffic. Deals 2x ATK + OVERLOADED (-5 ATK) for 2 turns.",
      cooldown: 2, color: "#ffff55",
      use: (p, e) => { const dmg = calcAtk(p) * 2; return { dmg, log: `[FLOOD] ${dmg} dmg -- ${e.name} is OVERLOADED, ATK crippled.`, statusToEnemy: { type: "overloaded", turns: 2, value: 5 } }; }
    }
  },
};

const STATUS_DEFS = {
  burn:       { label: "BURN",       color: "#f97316" },
  traced:     { label: "TRACED",     color: "#ff2d7a" },
  overloaded: { label: "OVERLOADED", color: "#facc15" },
};

// ─── SKILL TREES ─────────────────────────────────────────────────────────────
// Each perk: { id, name, desc, path, tier (1-3), apply(player) → mutated player }
// Paths: offense / defense / utility
// Tier 1 = available from lvl 2, tier 2 = lvl 4+, tier 3 = lvl 6+
// Player picks 1 perk per 2 levels. Max 5 perks by lvl 10.

const SKILL_TREES = {
  netrunner: {
    color: "#00ff9f",
    paths: {
      offense: {
        label: "EXPLOIT CHAIN", icon: "⚡",
        perks: [
          { id: "nr_o1", tier: 1, name: "Deep Packet",      desc: "+4 ATK permanently.",                         apply: p => ({ ...p, atk: p.atk + 4 }) },
          { id: "nr_o2", tier: 2, name: "Zero-Day Mastery", desc: "Zero-Day Exploit cooldown −1.",                apply: p => ({ ...p, _abilityBonus: (p._abilityBonus||0) - 1 }) },
          { id: "nr_o3", tier: 3, name: "Cascade Exploit",  desc: "Crits chain — 30% chance of a free second hit.", apply: p => ({ ...p, _cascadeCrit: true }) },
        ]
      },
      defense: {
        label: "FIREWALL", icon: "🛡",
        perks: [
          { id: "nr_d1", tier: 1, name: "Hardened Node",    desc: "+5 DEF permanently.",                         apply: p => ({ ...p, def: p.def + 5 }) },
          { id: "nr_d2", tier: 2, name: "Status Filter",    desc: "All hostile status effects last 1 turn less.", apply: p => ({ ...p, _statusResist: (p._statusResist||0) + 1 }) },
          { id: "nr_d3", tier: 3, name: "Neural Aegis",     desc: "+20 max HP. Absorb first lethal hit per run.", apply: p => ({ ...p, maxHp: p.maxHp + 20, hp: p.hp + 20, _deathShield: true }) },
        ]
      },
      utility: {
        label: "CREDIT HACK", icon: "₡",
        perks: [
          { id: "nr_u1", tier: 1, name: "Ghost Wallet",     desc: "Earn +20% credits from all fights.",          apply: p => ({ ...p, _creditBonus: (p._creditBonus||0) + 0.20 }) },
          { id: "nr_u2", tier: 2, name: "Back-Channel",     desc: "Grid intel (scout) is free.",                 apply: p => ({ ...p, _freeScout: true }) },
          { id: "nr_u3", tier: 3, name: "Corp Leech",       desc: "Each kill restores 8 HP.",                    apply: p => ({ ...p, _killHeal: (p._killHeal||0) + 8 }) },
        ]
      }
    }
  },
  ghost: {
    color: "#a78bfa",
    paths: {
      offense: {
        label: "BACKSTAB", icon: "◇",
        perks: [
          { id: "gh_o1", tier: 1, name: "Phantom Strike",   desc: "+8% crit chance permanently.",                apply: p => ({ ...p, _critBonus: (p._critBonus||0) + 0.08 }) },
          { id: "gh_o2", tier: 2, name: "Knife in the Dark",desc: "Crits deal 2.5× instead of 2×.",              apply: p => ({ ...p, _critMult: 2.5 }) },
          { id: "gh_o3", tier: 3, name: "Death Mark",       desc: "First attack each fight ignores all DEF.",    apply: p => ({ ...p, _firstStrikeIgnoreDef: true }) },
        ]
      },
      defense: {
        label: "EVASION", icon: "🛡",
        perks: [
          { id: "gh_d1", tier: 1, name: "Signal Mask",      desc: "+5 DEF. TRACED status can't be applied.",     apply: p => ({ ...p, def: p.def + 5, _immuneTraced: true }) },
          { id: "gh_d2", tier: 2, name: "Decoy Packet",     desc: "20% chance to dodge any attack entirely.",    apply: p => ({ ...p, _dodgeChance: (p._dodgeChance||0) + 0.20 }) },
          { id: "gh_d3", tier: 3, name: "Ghost Protocol+",  desc: "+25 max HP. Status effects miss on dodge.",   apply: p => ({ ...p, maxHp: p.maxHp + 25, hp: p.hp + 25 }) },
        ]
      },
      utility: {
        label: "INTEL", icon: "📡",
        perks: [
          { id: "gh_u1", tier: 1, name: "Recon Sweep",      desc: "+15% bonus XP from all fights.",              apply: p => ({ ...p, _xpBonus: (p._xpBonus||0) + 0.15 }) },
          { id: "gh_u2", tier: 2, name: "Shadow Market",    desc: "Black market gear costs 15% less.",           apply: p => ({ ...p, _shopDiscount: (p._shopDiscount||0) + 0.15 }) },
          { id: "gh_u3", tier: 3, name: "Vanishing Act",    desc: "Jack Out costs 0 turns.",                     apply: p => ({ ...p, _freeJackOut: true }) },
        ]
      }
    }
  },
  bruteforcer: {
    color: "#f97316",
    paths: {
      offense: {
        label: "RAW POWER", icon: "◆",
        perks: [
          { id: "br_o1", tier: 1, name: "Overclock",        desc: "+6 ATK permanently.",                         apply: p => ({ ...p, atk: p.atk + 6 }) },
          { id: "br_o2", tier: 2, name: "Burn Everything",  desc: "Crit burns deal 12 dmg instead of 8.",        apply: p => ({ ...p, _burnCritDmg: 12 }) },
          { id: "br_o3", tier: 3, name: "Rampage",          desc: "Each kill grants +3 ATK (stacks, resets daily).", apply: p => ({ ...p, _rampageKills: true }) },
        ]
      },
      defense: {
        label: "DAMAGE SOAK", icon: "🛡",
        perks: [
          { id: "br_d1", tier: 1, name: "Iron Frame",       desc: "+30 max HP permanently.",                     apply: p => ({ ...p, maxHp: p.maxHp + 30, hp: p.hp + 30 }) },
          { id: "br_d2", tier: 2, name: "Bleed Valve",      desc: "Regen 5 HP at the start of each combat round.", apply: p => ({ ...p, _combatRegen: (p._combatRegen||0) + 5 }) },
          { id: "br_d3", tier: 3, name: "Overplated",       desc: "+8 DEF. Reduce all incoming damage by 2.",    apply: p => ({ ...p, def: p.def + 8, _dmgReduction: (p._dmgReduction||0) + 2 }) },
        ]
      },
      utility: {
        label: "CREDIT RAID", icon: "₡",
        perks: [
          { id: "br_u1", tier: 1, name: "Smash & Grab",     desc: "PvP wins steal 35% instead of 25%.",          apply: p => ({ ...p, _pvpStealBonus: 0.10 }) },
          { id: "br_u2", tier: 2, name: "Intimidate",       desc: "Enemies have 15% less chance to use abilities.", apply: p => ({ ...p, _intimidate: 0.15 }) },
          { id: "br_u3", tier: 3, name: "Grid Terror",      desc: "+2 turns per day (12 total).",                 apply: p => ({ ...p, turnsLeft: p.turnsLeft + 2 }) },
        ]
      }
    }
  }
};

function getPerkById(id) {
  for (const cls of Object.values(SKILL_TREES)) {
    for (const path of Object.values(cls.paths)) {
      const found = path.perks.find(p => p.id === id);
      if (found) return found;
    }
  }
  return null;
}

function getPerkTierRequired(tier) { return tier === 1 ? 2 : tier === 2 ? 4 : 6; }

function getAvailablePerks(player) {
  const tree = SKILL_TREES[player.cls];
  if (!tree) return [];
  const owned = player.perks || [];
  const available = [];
  for (const [pathKey, path] of Object.entries(tree.paths)) {
    for (const perk of path.perks) {
      if (owned.includes(perk.id)) continue;
      if (player.level < getPerkTierRequired(perk.tier)) continue;
      // Tier 2/3 require previous tier in same path
      if (perk.tier > 1) {
        const prevTier = path.perks.find(p2 => p2.tier === perk.tier - 1);
        if (prevTier && !owned.includes(prevTier.id)) continue;
      }
      available.push({ ...perk, path: pathKey, pathLabel: path.label, pathIcon: path.icon });
    }
  }
  return available;
}

// Apply all owned perks to a stat calculation (for display)
function applyPerkStats(player) {
  let p = { ...player };
  for (const id of (player.perks || [])) {
    const perk = getPerkById(id);
    if (perk) p = perk.apply(p);
  }
  return p;
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

const SEASON_MONTHS = 6;
const LB_KEY = "netrunner_leaderboard";
const LB_META_KEY = "netrunner_lb_meta";
const HALL_KEY = "netrunner_hall_of_fame";
const CHAT_KEY = "netrunner_chat";
const CHAT_MAX = 50;
const CHAT_RATE_MS = 30000; // 30s cooldown
const CHAT_MAX_LEN = 140;

// ─── FACTIONS ─────────────────────────────────────────────────────────────────

const FACTION_WEEK_MS = 7 * 24 * 3600 * 1000;
const FACTION_KEY = "netrunner_factions";
const FACTION_CHAT_KEY = "netrunner_faction_chat";

// ─── THE GHOST COLLECTIVE ─────────────────────────────────────────────────────
// Secret faction. Not listed. Not explained. Found or not found.

const COLLECTIVE_KEY       = "netrunner_collective";
const COLLECTIVE_CHAT_KEY  = "netrunner_collective_chat";
const COLLECTIVE_CYCLE_MS  = 14 * 24 * 3600 * 1000; // 2 weeks per cycle
const COLLECTIVE_EPOCH     = 1700000000000; // fixed epoch so cycles sync across all players

// Each cycle has: conditions to join, clues scattered in the world, and a unique induction line
const COLLECTIVE_CYCLES = [
  {
    cycle: 1,
    label: "THE DARK RUNNER",
    conditions: { minLevel: 5, bossDefeated: true, maxRep: -200 },
    check: (p) => p.level >= 5 && p.bossDefeated && (p.rep||0) <= -200,
    // Clues — vague, deniable, scattered
    staticClue:   "// ...fragmented signal... 'those who flatline gods and burn their own name...' // static...",
    lyraClue:     "Someone left this for you. Wouldn't say who.",
    deadDropClue: "[ ??? ] the ones who crack the mainframe and still choose the dark — they know where to find us",
    inductionLine:"You cracked the Mainframe and chose shadow over light. We've been watching since your first raid.",
  },
  {
    cycle: 2,
    label: "THE BENEFACTOR",
    conditions: { pvpWins: 10, carePackagesSent: 3 },
    check: (p) => (p.pvpWins||0) >= 10 && (p.carePackagesSent||0) >= 3,
    staticClue:   "// ...carrier wave... 'strength that protects... violence that gives...' // corrupted...",
    lyraClue:     "You've been leaving things for people. Someone noticed.",
    deadDropClue: "[ ??? ] ten victories and three gifts. the paradox is the key.",
    inductionLine:"You fight hard and give freely. That contradiction is rarer than you know.",
  },
  {
    cycle: 3,
    label: "THE ASCETIC",
    conditions: { loginStreak: 14, pvpWins: 0, minRep: 0 },
    check: (p) => (p.loginStreak||0) >= 14 && (p.pvpWins||0) === 0 && (p.rep||0) >= 0,
    staticClue:   "// ...ghost signal... 'fourteen sunrises... never raised a fist...' // fading...",
    lyraClue:     "You've been coming in every day. Never start trouble. Someone finds that remarkable.",
    deadDropClue: "[ ??? ] two weeks. clean hands. the grid sees everything.",
    inductionLine:"14 days without violence. In this place, that takes more discipline than any raid.",
  },
  {
    cycle: 4,
    label: "THE COMPLETIONIST",
    conditions: { dungeonsCleared: 5, minLevel: 9 },
    check: (p) => (p.dungeonsCleared||[]).length >= 5 && p.level >= 9,
    staticClue:   "// ...frequency shift... 'all five doors... all five bosses... what remains...' // noise...",
    lyraClue:     "You've been everywhere. Seen everything. Someone wants to show you one more thing.",
    deadDropClue: "[ ??? ] five dungeons. five bosses. the one who clears all paths sees the hidden one.",
    inductionLine:"You went everywhere the grid offered. Then you found the door that wasn't on the map.",
  },
  {
    cycle: 5,
    label: "THE NEUTRAL",
    conditions: { minLevel: 7, exactRep: 0, minKills: 20 },
    check: (p) => p.level >= 7 && (p.rep||0) === 0 && (p.kills||0) >= 20,
    staticClue:   "// ...perfect silence... 'twenty kills... no allegiance... zero...' // exact...",
    lyraClue:     "Perfect balance. Someone's been watching you walk the edge.",
    deadDropClue: "[ ??? ] twenty kills. zero reputation. the empty scale is the hardest thing to hold.",
    inductionLine:"You killed twenty and remained perfectly neutral. The grid doesn't know what to make of you. Neither do we. That's why we want you.",
  },
];

function getCurrentCycle() {
  const idx = Math.floor((Date.now() - COLLECTIVE_EPOCH) / COLLECTIVE_CYCLE_MS) % COLLECTIVE_CYCLES.length;
  return COLLECTIVE_CYCLES[idx];
}

function getNextCycleMs() {
  const elapsed = (Date.now() - COLLECTIVE_EPOCH) % COLLECTIVE_CYCLE_MS;
  return COLLECTIVE_CYCLE_MS - elapsed;
}

function checkCollectiveEligibility(player) {
  const cycle = getCurrentCycle();
  return cycle.check(player);
}

async function joinCollective(player) {
  try {
    const key = `${COLLECTIVE_KEY}_members`;
    const r = await window.storage.get(key, true);
    const members = r ? JSON.parse(r.value) : [];
    const entry = {
      name: player.name, cls: player.cls, level: player.level,
      cycle: getCurrentCycle().cycle, joinedAt: Date.now(),
    };
    if (!members.find(m => m.name === player.name && m.cls === player.cls)) {
      members.push(entry);
      await window.storage.set(key, JSON.stringify(members), true);
    }
  } catch {}
}

async function isCollectiveMember(name, cls) {
  try {
    const key = `${COLLECTIVE_KEY}_members`;
    const r = await window.storage.get(key, true);
    const members = r ? JSON.parse(r.value) : [];
    return members.some(m => m.name === name && m.cls === cls);
  } catch { return false; }
}

async function loadCollectiveChat() {
  try {
    const r = await window.storage.get(COLLECTIVE_CHAT_KEY, true);
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}

async function postCollectiveChat(player, text) {
  try {
    const msgs = await loadCollectiveChat();
    const msg = {
      id: Date.now() + Math.random(),
      name: player.name, cls: player.cls, level: player.level,
      text: text.slice(0, 140), ts: Date.now(),
    };
    const updated = [msg, ...msgs].slice(0, 30);
    await window.storage.set(COLLECTIVE_CHAT_KEY, JSON.stringify(updated), true);
    return updated;
  } catch { return []; }
}
const PROFILES_KEY = "netrunner_profiles";
const PROFILE_MSGS_KEY = "netrunner_profile_msgs";
const ATTACK_LOG_KEY = "netrunner_attack_log";
const GRID_ACTIVITY_KEY = "netrunner_grid_activity";
const LYRA_MARRIAGE_KEY = "netrunner_lyra_marriage";

async function postGridActivity(event) {
  try {
    const entry = { ...event, ts: Date.now(), id: Date.now() + Math.random() };
    await fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
  } catch {}
}

async function loadGridActivity() {
  try {
    const res = await fetch("/api/activity");
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function getLyraMarriage() {
  try { const r = await window.storage.get(LYRA_MARRIAGE_KEY, true); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}

async function setLyraMarriageData(name, cls) {
  try { await window.storage.set(LYRA_MARRIAGE_KEY, JSON.stringify({name, cls, ts:Date.now()}), true); }
  catch {}
}

// Log an attack against a defender (called when PvP attack resolves)
async function logOfflineAttack(defenderName, defenderCls, entry) {
  try {
    const key = `${ATTACK_LOG_KEY}_${defenderName}_${defenderCls}`;
    const r = await window.storage.get(key, true);
    const log = r ? JSON.parse(r.value) : [];
    const updated = [entry, ...log].slice(0, 10); // keep last 10
    await window.storage.set(key, JSON.stringify(updated), true);
  } catch {}
}

// Load and clear the attack log for a player on login
async function popAttackLog(name, cls) {
  try {
    const key = `${ATTACK_LOG_KEY}_${name}_${cls}`;
    const r = await window.storage.get(key, true);
    if (!r) return [];
    const log = JSON.parse(r.value);
    // Clear it immediately so it only shows once
    await window.storage.set(key, JSON.stringify([]), true);
    return log;
  } catch { return []; }
}

// Profile data stored per player name+cls
async function loadProfileData(name, cls) {
  // Try server first
  try {
    const res = await fetch(`/api/profiles/${encodeURIComponent(name)}`);
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch {}
  // Fall back to window.storage (artifact mode)
  try {
    const key = `${PROFILES_KEY}_${name}_${cls}`;
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}

async function saveProfileData(player) {
  try {
    const key = `${PROFILES_KEY}_${player.name}_${player.cls}`;
    const profile = {
      name: player.name, cls: player.cls, level: player.level,
      kills: player.kills, pvpWins: player.pvpWins || 0, pvpLosses: player.pvpLosses || 0,
      bossDefeated: player.bossDefeated || false,
      factionId: player.factionId, factionXP: player.factionXP || 0,
      loginStreak: player.loginStreak || 0, longestStreak: player.longestStreak || 0,
      dungeonTitles: player.dungeonTitles || [],
      badges: player.badges || [],
      achievements: player.badges || [],
      perks: (player.perks || []).length,
      credits: player.credits,
      updatedAt: Date.now(),
    };
    await window.storage.set(key, JSON.stringify(profile), true);
  } catch {}
}

async function loadProfileMessages(name, cls) {
  try {
    const key = `${PROFILE_MSGS_KEY}_${name}_${cls}`;
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}

async function postProfileMessage(targetName, targetCls, fromPlayer, text) {
  try {
    const key = `${PROFILE_MSGS_KEY}_${targetName}_${targetCls}`;
    const msgs = await loadProfileMessages(targetName, targetCls);
    const msg = {
      id: Date.now() + Math.random(),
      from: fromPlayer.name, fromCls: fromPlayer.cls, fromLevel: fromPlayer.level,
      text: text.slice(0, 120),
      ts: Date.now(),
    };
    const updated = [msg, ...msgs].slice(0, 10);
    await window.storage.set(key, JSON.stringify(updated), true);
    return updated;
  } catch { return []; }
}

const FACTIONS = {
  ghost_protocol: {
    id: "ghost_protocol", name: "GHOST PROTOCOL", icon: "◇", color: "#ff55ff",
    tagline: "Shadows never flatline.",
    desc: "Stealth runners and anti-corp operatives. Built on silence and precision.",
    bonuses: ["+15% XP from all combat", "Grid events skew toward windfalls", "Enemies 10% less likely to use abilities"],
    apply: (p) => ({ _xpBonus: (p._xpBonus||0)+0.15, _intimidate: (p._intimidate||0)+0.10, _factionEventBias: "windfall" }),
  },
  deadlock: {
    id: "deadlock", name: "DEADLOCK", icon: "◆", color: "#ff5555",
    tagline: "We don't crack systems. We own them.",
    desc: "Bruteforce raiders and credit hunters. Strength through overwhelming force.",
    bonuses: ["+20% credits from all combat", "PvP steal increased to 35%", "+4 ATK while in faction"],
    apply: (p) => ({ _creditBonus: (p._creditBonus||0)+0.20, _pvpStealBonus: (p._pvpStealBonus||0)+0.10, atk: p.atk+4 }),
  },
  cipher_syndicate: {
    id: "cipher_syndicate", name: "CIPHER SYNDICATE", icon: "◈", color: "#55ffff",
    tagline: "Information is the only currency that matters.",
    desc: "Netrunners and info brokers. Masters of the exploit and the back channel.",
    bonuses: ["Ability cooldowns -1", "Black market gear 10% cheaper", "+10% XP from grid events"],
    apply: (p) => ({ _abilityBonus: (p._abilityBonus||0)-1, _shopDiscount: (p._shopDiscount||0)+0.10, _eventXpBonus: (p._eventXpBonus||0)+0.10 }),
  },
};

const FACTION_RANKS = [
  { name: "RECRUIT",   fxpRequired: 0    },
  { name: "RUNNER",    fxpRequired: 200  },
  { name: "OPERATIVE", fxpRequired: 600  },
  { name: "ELITE",     fxpRequired: 1500 },
];

function getFactionRank(fxp) {
  let rank = FACTION_RANKS[0];
  for (const r of FACTION_RANKS) { if (fxp >= r.fxpRequired) rank = r; }
  return rank;
}

async function loadFactionData() {
  try {
    const r = await window.storage.get(FACTION_KEY, true);
    const now = Date.now();
    const data = r ? JSON.parse(r.value) : null;
    if (!data) {
      const fresh = { weekStart: now, week: 1, totals: { ghost_protocol:0, deadlock:0, cipher_syndicate:0 }, lastWinner: null, history: [] };
      await window.storage.set(FACTION_KEY, JSON.stringify(fresh), true);
      return fresh;
    }
    // Weekly reset
    if (now - data.weekStart >= FACTION_WEEK_MS) {
      const sorted = Object.entries(data.totals||{}).sort((a,b)=>b[1]-a[1]);
      const winner = sorted[0] ? { id: sorted[0][0], fxp: sorted[0][1], week: data.week } : null;
      const reset = { weekStart: now, week: (data.week||1)+1, totals: { ghost_protocol:0, deadlock:0, cipher_syndicate:0 }, lastWinner: winner, history: [...(data.history||[]).slice(-4), winner].filter(Boolean) };
      await window.storage.set(FACTION_KEY, JSON.stringify(reset), true);
      return reset;
    }
    if (!data.totals) data.totals = { ghost_protocol:0, deadlock:0, cipher_syndicate:0 };
    return data;
  } catch { return { weekStart: Date.now(), week:1, totals:{ ghost_protocol:0, deadlock:0, cipher_syndicate:0 }, lastWinner:null, history:[] }; }
}

async function contributeFactionXP(factionId, amount) {
  try {
    const data = await loadFactionData();
    data.totals[factionId] = (data.totals[factionId]||0) + amount;
    await window.storage.set(FACTION_KEY, JSON.stringify(data), true);
    return data;
  } catch { return null; }
}

async function loadFactionChat(factionId) {
  try {
    const r = await window.storage.get(`${FACTION_CHAT_KEY}_${factionId}`, true);
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}

async function postFactionChatMsg(player, text) {
  try {
    const msgs = await loadFactionChat(player.factionId);
    const msg = { id: Date.now()+Math.random(), name: player.name, cls: player.cls, level: player.level, fxp: player.factionXP||0, text: text.slice(0,CHAT_MAX_LEN), ts: Date.now() };
    const updated = [msg, ...msgs].slice(0, 40);
    await window.storage.set(`${FACTION_CHAT_KEY}_${player.factionId}`, JSON.stringify(updated), true);
    return updated;
  } catch { return []; }
}

function applyFactionBonuses(p) {
  if (!p.factionId || !FACTIONS[p.factionId]) return p;
  return { ...p, ...FACTIONS[p.factionId].apply(p) };
}

// FXP earned per action
const FXP_TABLE = { kill: 5, pvpWin: 25, questClaim: 30, bossKill: 100, gridEvent: 3, dungeonClear: 75 };

// ─── GRID RATING SYSTEM ───────────────────────────────────────────────────────

const SPONSORS = {
  // Aggressive / evil path
  deadlock_armaments: {
    id: "deadlock_armaments", name: "DEADLOCK ARMAMENTS", faction: "deadlock",
    alignment: "evil", color: "#ff5555",
    tagline: "Destruction is our business.",
    perks: ["+15% PvP credits stolen", "Enemies drop extra loot", "Bounty bonuses +10%"],
    minThreat: 40, minAudience: 200,
  },
  corp_sec_talent: {
    id: "corp_sec_talent", name: "CORP-SEC TALENT DIVISION", faction: null,
    alignment: "evil", color: "#ff5555",
    tagline: "We invest in results. Whatever it takes.",
    perks: ["+20% credits from all combat", "Corp enemies 10% weaker vs you", "Weekly credit stipend"],
    minThreat: 70, minAudience: 800,
  },
  // Neutral / fixer path
  cipher_data_brokers: {
    id: "cipher_data_brokers", name: "CIPHER DATA BROKERS", faction: "cipher_syndicate",
    alignment: "neutral", color: "#55ffff",
    tagline: "Information is leverage.",
    perks: ["Free Static intel daily", "+10% XP from grid events", "Exchange rate bonus"],
    minEntertainment: 40, minAudience: 300,
  },
  neon_refuge_collective: {
    id: "neon_refuge_collective", name: "NEON REFUGE COLLECTIVE", faction: null,
    alignment: "neutral", color: "#ff55ff",
    tagline: "The grid needs legends.",
    perks: ["Lyra drinks 15% cheaper", "+5% all XP", "Profile badge"],
    minEntertainment: 60, minAudience: 500,
  },
  // Good / hero path
  ghost_protocol_ops: {
    id: "ghost_protocol_ops", name: "GHOST PROTOCOL OPS", faction: "ghost_protocol",
    alignment: "good", color: "#ff55ff",
    tagline: "Run clean. Run fast. Run free.",
    perks: ["+15% XP from all runs", "Safe mode cost -50%", "Enemies less likely to crit"],
    minSurvival: 40, minAudience: 200,
  },
  underground_broadcast: {
    id: "underground_broadcast", name: "UNDERGROUND BROADCAST", faction: null,
    alignment: "good", color: "#ffff55",
    tagline: "The grid's watching. Give them a show.",
    perks: ["+10% credits on dramatic wins", "Bonus turns on close calls", "Fan care packages"],
    minEntertainment: 80, minAudience: 1000,
  },
};

const REP_TITLES = [
  { min: 500,  title: "GHOST",     color: "#ff55ff", desc: "A legend. The grid whispers your name." },
  { min: 200,  title: "FIXER",     color: "#55ffff", desc: "Connected. Trusted. Dangerous." },
  { min: 50,   title: "RUNNER",    color: "#55ff55", desc: "Still finding your place on the grid." },
  { min: -49,  title: "NEUTRAL",   color: "#aaaaaa", desc: "The grid hasn't decided what you are yet." },
  { min: -199, title: "RAZORBOI",  color: "#ffff55", desc: "A name that makes people check their wallets." },
  { min: -499, title: "DEMONHEAD", color: "#ff5555", desc: "The grid fears you. So does everyone on it." },
];

function getRepTitle(rep) {
  for (const r of REP_TITLES) { if (rep >= r.min) return r; }
  return REP_TITLES[REP_TITLES.length - 1];
}

function calcAudienceSize(p) {
  const r = p.gridRating || { entertainment: 0, threat: 0, survival: 0 };
  const base = (r.entertainment + r.threat + r.survival) * 3;
  const streakBonus = (p.loginStreak || 0) * 10;
  const killBonus = (p.kills || 0) * 2;
  return Math.floor(base + streakBonus + killBonus);
}

function getActiveSponsor(p) {
  const audience = calcAudienceSize(p);
  const r = p.gridRating || { entertainment: 0, threat: 0, survival: 0 };
  const rep = p.rep || 0;

  // Check sponsors in order of prestige (highest reqs first)
  const candidates = Object.values(SPONSORS).filter(s => {
    if (s.minAudience && audience < s.minAudience) return false;
    if (s.minThreat && r.threat < s.minThreat) return false;
    if (s.minEntertainment && r.entertainment < s.minEntertainment) return false;
    if (s.minSurvival && r.survival < s.minSurvival) return false;
    // Alignment match
    if (s.alignment === "evil" && rep > 0) return false;
    if (s.alignment === "good" && rep < 0) return false;
    return true;
  });

  if (candidates.length === 0) return null;
  // Return highest prestige sponsor
  return candidates.sort((a, b) => (b.minAudience || 0) - (a.minAudience || 0))[0];
}

// Rating update helpers
function updateRating(p, type, amount) {
  const r = { entertainment: 0, threat: 0, survival: 0, ...(p.gridRating || {}) };
  r[type] = Math.min(100, Math.max(0, (r[type] || 0) + amount));
  return { ...p, gridRating: r };
}

function updateRep(p, amount) {
  return { ...p, rep: Math.max(-500, Math.min(500, (p.rep || 0) + amount)) };
}

// ─── DUNGEONS ─────────────────────────────────────────────────────────────────

const DUNGEON_TURN_COST = 3;

const DUNGEONS = [
  {
    id: "sewers", name: "THE SEWERS", icon: "▓", color: "#55ff55", levelReq: 1,
    desc: "An abandoned subnet rotting beneath the grid. Weak ICE, but plenty of it.",
    titleReward: "SEWER RAT",
    rooms: [
      { name: "Flooded Node",     enemyLevel: 1, creditBonus: 20,  xpBonus: 15  },
      { name: "Broken Junction",  enemyLevel: 1, creditBonus: 25,  xpBonus: 20  },
      { name: "Corrupt Cache",    enemyLevel: 2, creditBonus: 35,  xpBonus: 30  },
      { name: "Daemon Nest",      enemyLevel: 2, creditBonus: 40,  xpBonus: 35  },
      { name: "Sewer Daemon",     enemyLevel: 3, creditBonus: 100, xpBonus: 80, boss: true, bossName: "SEWER DAEMON",  bossItem: "stim_injector" },
    ],
  },
  {
    id: "corp_tower", name: "CORP TOWER", icon: "█", color: "#55ffff", levelReq: 3,
    desc: "A megacorp datacenter bristling with corporate ICE and automated sentinels.",
    titleReward: "CORPORATE RAIDER",
    rooms: [
      { name: "Lobby Level",      enemyLevel: 2, creditBonus: 35,  xpBonus: 25  },
      { name: "Server Farm",      enemyLevel: 3, creditBonus: 45,  xpBonus: 35  },
      { name: "Executive Floor",  enemyLevel: 3, creditBonus: 55,  xpBonus: 45  },
      { name: "Security Core",    enemyLevel: 4, creditBonus: 65,  xpBonus: 55  },
      { name: "Tower Summit",     enemyLevel: 5, creditBonus: 150, xpBonus: 120, boss: true, bossName: "TOWER SENTINEL", bossItem: "ice_breaker" },
    ],
  },
  {
    id: "black_market", name: "BLACK MARKET", icon: "◆", color: "#ff55ff", levelReq: 5,
    desc: "A criminal network node. Everyone here wants to kill you and take your deck.",
    titleReward: "CRIME LORD",
    rooms: [
      { name: "Fence District",   enemyLevel: 3, creditBonus: 50,  xpBonus: 35  },
      { name: "Smuggler's Run",   enemyLevel: 4, creditBonus: 65,  xpBonus: 45  },
      { name: "The Pit",          enemyLevel: 4, creditBonus: 75,  xpBonus: 55  },
      { name: "Cartel Node",      enemyLevel: 5, creditBonus: 90,  xpBonus: 70  },
      { name: "Crime Throne",     enemyLevel: 6, creditBonus: 200, xpBonus: 160, boss: true, bossName: "CRIME LORD AI", bossItem: "exploit_kit" },
    ],
  },
  {
    id: "military_grid", name: "MILITARY GRID", icon: "◈", color: "#ffff55", levelReq: 7,
    desc: "Classified defense network. Militarized ICE. No mercy protocols.",
    titleReward: "WAR CRIMINAL",
    rooms: [
      { name: "Perimeter",        enemyLevel: 4, creditBonus: 65,  xpBonus: 50  },
      { name: "Weapons Cache",    enemyLevel: 5, creditBonus: 80,  xpBonus: 65  },
      { name: "Command Deck",     enemyLevel: 5, creditBonus: 95,  xpBonus: 75  },
      { name: "Killswitch Room",  enemyLevel: 6, creditBonus: 110, xpBonus: 90  },
      { name: "War Machine Core", enemyLevel: 7, creditBonus: 250, xpBonus: 200, boss: true, bossName: "WAR MACHINE", bossItem: "neural_patch" },
    ],
  },
  {
    id: "mainframe", name: "THE MAINFRAME", icon: "★", color: "#ffffff", levelReq: 9,
    desc: "The endgame. The Megacorp's deepest node. No runner has ever come back from this.",
    titleReward: "GRID GOD",
    rooms: [
      { name: "Outer Shell",      enemyLevel: 5, creditBonus: 80,  xpBonus: 65  },
      { name: "Neural Labyrinth", enemyLevel: 6, creditBonus: 100, xpBonus: 85  },
      { name: "Core Firewall",    enemyLevel: 7, creditBonus: 120, xpBonus: 100 },
      { name: "Omega Protocol",   enemyLevel: 7, creditBonus: 140, xpBonus: 115 },
      { name: "OMEGA AI",         enemyLevel: 8, creditBonus: 400, xpBonus: 350, boss: true, bossName: "OMEGA AI", bossItem: "neural_patch", legendary: true },
    ],
  },
];

function getDungeonEnemy(room) {
  // Build a scaled enemy based on room level
  const base = ENEMIES.filter(e => e.level <= room.enemyLevel);
  const e = { ...base[base.length - 1] }; // highest eligible
  if (room.boss) {
    return {
      ...e,
      name: room.bossName,
      hp: e.hp * 2,
      atk: Math.floor(e.atk * 1.4),
      def: Math.floor(e.def * 1.3),
      xp: e.xp * 2 + room.xpBonus,
      credits: e.credits + room.creditBonus,
      boss: true,
      level: room.enemyLevel,
    };
  }
  return {
    ...e,
    name: room.name,
    xp: e.xp + room.xpBonus,
    credits: e.credits + room.creditBonus,
    level: room.enemyLevel,
  };
}

// ─── LOGIN STREAK ─────────────────────────────────────────────────────────────

const ACHIEVEMENTS = {
  welcome:      { id:"welcome",      icon:"🖥️", name:"WELCOME TO THE GRID",     desc:"You jacked in for the first time. The grid noticed. It wasn't impressed. Yet.",                                           reward:{credits:50,turns:1} },
  first_blood:  { id:"first_blood",  icon:"🩸", name:"FIRST BLOOD",             desc:"Congratulations. You killed something weaker than you. The grid is impressed. It isn't.",                               reward:{credits:100} },
  kill_10:      { id:"kill_10",      icon:"💀", name:"GETTING WARMED UP",       desc:"10 kills. You've graduated from 'accidental threat' to 'minor inconvenience'.",                                         reward:{credits:150} },
  kill_50:      { id:"kill_50",      icon:"☠️", name:"KILL THEM ALL",           desc:"50 kills. The bodies are stacking up. The grid has given you a nickname. It's not flattering.",                        reward:{credits:300} },
  kill_100:     { id:"kill_100",     icon:"🏭", name:"INDUSTRIAL SCALE",        desc:"100 kills. At this point you're not a runner. You're a natural disaster.",                                             reward:{credits:500} },
  glass_cannon: { id:"glass_cannon", icon:"🔮", name:"GLASS CANNON",            desc:"Won a fight at under 5% HP. The crowd went absolutely feral. STATIC played your theme song.",                         reward:{critBonus:0.05} },
  first_death:  { id:"first_death",  icon:"📉", name:"FLATLINER",               desc:"You died. To a Script Kiddie. We're not going to talk about this.",                                                    reward:{turns:1} },
  die_10:       { id:"die_10",       icon:"🪦", name:"FREQUENT DIER",           desc:"Flatlined 10 times. At this point the ICE knows your face. It waves when you arrive.",                                 reward:{maxHp:50} },
  the_turtle:   { id:"the_turtle",   icon:"🐢", name:"THE TURTLE",              desc:"Fled from 5 fights in a row. Discretion is the better part of valour. Or cowardice. One of those.",                   reward:{credits:50} },
  first_pvp:    { id:"first_pvp",    icon:"🎯", name:"MUGGER",                  desc:"Your first PvP win. You raided another player. Their credits are your credits now. Capitalism.",                       reward:{credits:100} },
  pvp_10:       { id:"pvp_10",       icon:"🔫", name:"SERIAL RAIDER",           desc:"10 PvP wins. You have become the reason people buy Safe Mode.",                                                        reward:{credits:200} },
  punching_down:{ id:"punching_down",icon:"👇", name:"PUNCHING DOWN",           desc:"Attacked someone 5+ levels below you. The audience booed. The sponsors noticed. We noticed.",                         reward:{rep:-50} },
  punching_up:  { id:"punching_up",  icon:"👆", name:"PUNCHING UP",             desc:"Attacked someone 5+ levels above you. Bold. Stupid. Entertaining. STATIC gave you a shoutout.",                      reward:{credits:150} },
  budget_threats:{ id:"budget_threats",icon:"📋",name:"BUDGET THREATS",         desc:"You placed a bounty on someone. Very intimidating. Very cyberpunk. Very you.",                                        reward:{credits:50} },
  landlord:     { id:"landlord",     icon:"🏠", name:"LANDLORD",                desc:"Raided someone with under 100 credits. They had nothing. You took it anyway. Truly the villain.",                     reward:{rep:-25} },
  generous:     { id:"generous",     icon:"🎁", name:"GENEROUS TO A FAULT",     desc:"Sent 3 care packages. Either you're very kind or very lonely. The grid appreciates both.",                            reward:{rep:50} },
  saint:        { id:"saint",        icon:"😇", name:"CERTIFIED SAINT",         desc:"Sent 10 care packages. Lyra is starting to suspect you're running some kind of charity. She respects it.",            reward:{rep:100,credits:200} },
  streak_7:     { id:"streak_7",     icon:"📅", name:"TOUCHED GRASS",           desc:"Logged in 7 days in a row. We're starting to worry about you. Have you eaten?",                                      reward:{maxTurns:2} },
  streak_14:    { id:"streak_14",    icon:"🌿", name:"WHAT IS OUTSIDE",         desc:"14-day login streak. At this point the grid is your home. This isn't a compliment.",                                  reward:{maxTurns:3} },
  streak_30:    { id:"streak_30",    icon:"🏕️", name:"ACTUALLY TOUCHED GRASS",  desc:"30 days straight. Please go outside. We mean it. There are trees. They're nice.",                                   reward:{maxTurns:5} },
  boss_kill:    { id:"boss_kill",    icon:"👑", name:"MAINFRAME CRACKER",       desc:"You beat the Megacorp AI. You're either very good or very lucky. The Megacorp suspects the latter.",                  reward:{credits:500} },
  completionist:{ id:"completionist",icon:"🗺️", name:"COMPLETIONIST",           desc:"All 5 dungeons cleared. You have a problem. It's a good problem. We're proud of you. Mostly.",                      reward:{credits:300,turns:2} },
  read_the_room:{ id:"read_the_room",icon:"📖", name:"READ THE ROOM",           desc:"Joined a faction in your first 3 days. You're either a joiner or you read the guide. Respect.",                      reward:{credits:100} },
  lone_wolf:    { id:"lone_wolf",    icon:"🐺", name:"LONE WOLF",               desc:"Rank 5 and still no faction. Commitment issues or just vibes. The grid respects it. Barely.",                        reward:{credits:100} },
  social_butterfly:{ id:"social_butterfly",icon:"🦋",name:"SOCIAL BUTTERFLY",  desc:"Posted 10 Dead Drop messages. Nobody asked but here we are. STATIC thinks you're parasocial.",                       reward:{credits:50} },
  lyra_fan:     { id:"lyra_fan",     icon:"💜", name:"REGULAR",                 desc:"Talked to Lyra 20 times. She knows your order. She's starting to remember your problems.",                            reward:{credits:100} },
  lyra_married: { id:"lyra_married", icon:"💍", name:"OFF THE MARKET",          desc:"You married the bartender. Nobody else can flirt with her now. The grid is somehow both jealous and relieved.",       reward:{} },
  skill_maxed:  { id:"skill_maxed",  icon:"🧠", name:"FULLY LOADED",            desc:"Maxed out your skill tree. You are operating at peak runner capacity. The grid is mildly threatened.",                reward:{credits:200} },
  ghost_collective:{ id:"ghost_collective",icon:"◬",name:"◬ ◬ ◬",              desc:"You found something that isn't supposed to exist. Don't tell anyone.",                                                 secret:true, reward:{} },
  absolute_neutral:{ id:"absolute_neutral",icon:"⚖️",name:"THE SCALE",         desc:"Exactly 0 reputation at rank 7+. The grid has no idea what you are. Neither do we.",                                  secret:true, reward:{credits:250} },
};

function checkAchievements(player, context = {}) {
  const existing = new Set(player.badges || []);
  const toUnlock = [];
  const p = player;
  const add = (id) => { if (!existing.has(id) && ACHIEVEMENTS[id]) toUnlock.push(id); };

  if (context.firstRun)   add("welcome");
  if ((p.kills||0) >= 1)  add("first_blood");
  if ((p.kills||0) >= 10) add("kill_10");
  if ((p.kills||0) >= 50) add("kill_50");
  if ((p.kills||0) >= 100) add("kill_100");
  if (context.lowHpWin)   add("glass_cannon");
  if (context.firstDeath) add("first_death");
  if ((p.deaths||0) >= 10) add("die_10");
  if (context.fled >= 5)  add("the_turtle");
  if ((p.pvpWins||0) >= 1)  add("first_pvp");
  if ((p.pvpWins||0) >= 10) add("pvp_10");
  if (context.punchedDown)  add("punching_down");
  if (context.punchedUp)    add("punching_up");
  if ((p.bounties||[]).length >= 1) add("budget_threats");
  if (context.raidedPoor)   add("landlord");
  if ((p.carePackagesSent||0) >= 3)  add("generous");
  if ((p.carePackagesSent||0) >= 10) add("saint");
  if ((p.loginStreak||0) >= 7)  add("streak_7");
  if ((p.loginStreak||0) >= 14) add("streak_14");
  if ((p.loginStreak||0) >= 30) add("streak_30");
  if (p.bossDefeated) add("boss_kill");
  if ((p.dungeonsCleared||[]).length >= 5) add("completionist");
  if (p.factionId && p.level <= 3) add("read_the_room");
  if (!p.factionId && p.level >= 5) add("lone_wolf");
  if ((p.chatCount||0) >= 10) add("social_butterfly");
  if ((p.lyraFlirtCount||0) >= 20) add("lyra_fan");
  if (p.lyraMarried) add("lyra_married");
  if ((p.perks||[]).length >= 9) add("skill_maxed");
  if (p.inCollective) add("ghost_collective");
  if ((p.rep||0) === 0 && p.level >= 7 && (p.kills||0) >= 20) add("absolute_neutral");
  return toUnlock;
}

const STREAK_MILESTONES = [
  { day: 2,  label: "Day 2",  reward: { turns: 2 },                                    desc: "+2 bonus turns" },
  { day: 3,  label: "Day 3",  reward: { credits: 50 },                                 desc: "+₡50" },
  { day: 5,  label: "Day 5",  reward: { item: "stim_injector" },                       desc: "+Stim Injector" },
  { day: 7,  label: "Day 7",  reward: { turns: 3, item: "ice_breaker", fxp: 50 },      desc: "+3 turns, ICE Breaker, 50 FXP" },
  { day: 14, label: "Day 14", reward: { turns: 5, item: "neural_patch", perkPoint: 1 },desc: "+5 turns, Neural Patch, Perk Point" },
  { day: 30, label: "Day 30", reward: { atk: 5, badge: "GRID_LEGEND", turns: 5 },      desc: "+5 ATK permanent, Grid Legend badge, +5 turns" },
];

function getMilestoneForDay(day) {
  // Return the milestone if today is exactly a milestone day, else null
  return STREAK_MILESTONES.find(m => m.day === day) || null;
}

function getNextMilestone(currentStreak) {
  return STREAK_MILESTONES.find(m => m.day > currentStreak) || null;
}

function applyStreakReward(player, milestone) {
  let p = { ...player };
  const r = milestone.reward;
  if (r.turns)     p.turnsLeft = Math.min(p.turnsLeft + r.turns, MAX_TURNS + r.turns); // allow over-cap on streak reward
  if (r.credits)   p.credits += r.credits;
  if (r.fxp && p.factionId) p.factionXP = (p.factionXP || 0) + r.fxp;
  if (r.perkPoint) p.perkPoints = (p.perkPoints || 0) + 1;
  if (r.atk)       { p.atk += r.atk; p._streakAtkBonus = (p._streakAtkBonus || 0) + r.atk; }
  if (r.badge)     p.badges = [...(p.badges || []), r.badge];
  if (r.item) {
    const { inv, added } = addToInventory(p.inventory, r.item);
    if (added) p.inventory = inv;
  }
  return p;
}

function calcStreakOnLogin(saved) {
  // Returns { saved (mutated), milestone, isNewDay, streakBroken }
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  if (saved.lastLoginDate === today) {
    // Already logged in today — no change
    return { saved, milestone: null, isNewDay: false, streakBroken: false };
  }

  const wasYesterday = saved.lastLoginDate === yesterday;
  const streakBroken = saved.loginStreak > 0 && !wasYesterday;

  if (streakBroken) {
    saved.loginStreak = 1;
  } else {
    saved.loginStreak = (saved.loginStreak || 0) + 1;
  }

  // Record this login in history (last 30 days)
  const history = saved.loginHistory || [];
  history.push(today);
  saved.loginHistory = history.slice(-30);
  saved.lastLoginDate = today;
  saved.longestStreak = Math.max(saved.longestStreak || 0, saved.loginStreak);

  const milestone = getMilestoneForDay(saved.loginStreak);
  return { saved, milestone, isNewDay: true, streakBroken };
}

function scoreValue(entry) {
  // Composite score: boss kill worth a lot, then level, kills, credits
  return (entry.bossDefeated ? 100000 : 0) + entry.level * 5000 + entry.kills * 200 + Math.floor((entry.credits || 0) / 10);
}

async function lbGet(key) {
  try {
    const r = await window.storage.get(key, true);
    return r ? JSON.parse(r.value) : null;
  } catch { return null; }
}

async function lbSet(key, val) {
  try { await window.storage.set(key, JSON.stringify(val), true); } catch {}
}

async function loadChat() {
  try {
    const token = localStorage.getItem('netrunner_token');
    const res = await fetch('/api/chat', {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
    });
    if (res.ok) return await res.json();
  } catch {}
  try {
    const r = await window.storage.get(CHAT_KEY, true);
    return r ? JSON.parse(r.value) : [];
  } catch { return []; }
}

async function postChatMessage(player, text, type = "player") {
  try {
    const token = localStorage.getItem('netrunner_token');
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ name: player.name, cls: player.cls, level: player.level, text, type }),
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch {}
  // Fall back to localStorage
  const messages = await loadChat();
  const msg = { id: Date.now()+Math.random(), type, name: player.name, cls: player.cls, level: player.level, text: text.slice(0,140), ts: Date.now() };
  const updated = [msg, ...messages].slice(0,30);
  await window.storage.set(CHAT_KEY, JSON.stringify(updated), true);
  return updated;
}

async function postSystemMessage(text) {
  const messages = await loadChat();
  const msg = { id: Date.now() + Math.random(), type: "system", name: "GRID", cls: null, level: null, text, ts: Date.now() };
  const updated = [msg, ...messages].slice(0, CHAT_MAX);
  try { await window.storage.set(CHAT_KEY, JSON.stringify(updated), true); } catch {}
  return updated;
}

async function loadLeaderboard() {
  const [entries, meta, hall] = await Promise.all([lbGet(LB_KEY), lbGet(LB_META_KEY), lbGet(HALL_KEY)]);
  const now = Date.now();
  // Bootstrap meta if missing
  let m = meta || { seasonStart: now, season: 1 };
  // Check if season has expired
  const monthsElapsed = (now - m.seasonStart) / (1000 * 60 * 60 * 24 * 30);
  if (monthsElapsed >= SEASON_MONTHS) {
    // Archive top 3 to hall of fame
    const sorted = (entries || []).sort((a, b) => scoreValue(b) - scoreValue(a));
    const top3 = sorted.slice(0, 3);
    const newHall = [...(hall || []), { season: m.season, date: new Date(m.seasonStart).toLocaleDateString(), winners: top3 }];
    await lbSet(HALL_KEY, newHall);
    await lbSet(LB_KEY, []);
    m = { seasonStart: now, season: m.season + 1 };
    await lbSet(LB_META_KEY, m);
    return { entries: [], meta: m, hall: newHall };
  }
  return { entries: entries || [], meta: m, hall: hall || [] };
}

async function submitScore(player) {
  const { entries, meta } = await loadLeaderboard();
  const entry = {
    name: player.name,
    cls: player.cls,
    level: player.level,
    kills: player.kills,
    credits: player.credits,
    pvpWins: player.pvpWins || 0,
    bossDefeated: player.bossDefeated || false,
    perks: (player.perks || []).length,
    ts: Date.now(),
  };
  // Remove previous entry for same name+class, keep best
  const filtered = entries.filter(e => !(e.name === entry.name && e.cls === entry.cls) || scoreValue(e) > scoreValue(entry));
  const already = entries.find(e => e.name === entry.name && e.cls === entry.cls);
  const final = already && scoreValue(already) >= scoreValue(entry)
    ? entries  // existing is better, don't overwrite
    : [...filtered, entry];
  const sorted = final.sort((a, b) => scoreValue(b) - scoreValue(a)).slice(0, 100);
  await lbSet(LB_KEY, sorted);
  return sorted;
}

const ENEMIES = [
  { name: "Script Kiddie",   hp: 20,  atk: 5,  def: 1,  xp: 10,  credits: 15,  level: 1 },
  { name: "Watchdog ICE",    hp: 35,  atk: 8,  def: 3,  xp: 20,  credits: 25,  level: 2, ability: { name: "Trace Pulse",  effect: { type: "traced",     turns: 2, value: 3  }, chance: 0.30 } },
  { name: "Black ICE",       hp: 55,  atk: 13, def: 5,  xp: 40,  credits: 45,  level: 3, ability: { name: "Burn Packet",  effect: { type: "burn",       turns: 3, value: 6  }, chance: 0.35 } },
  { name: "Corp Sentinel",   hp: 80,  atk: 18, def: 8,  xp: 70,  credits: 80,  level: 4, ability: { name: "Lockdown",     effect: { type: "overloaded", turns: 2, value: 6  }, chance: 0.40 } },
  { name: "Neural Firewall", hp: 120, atk: 24, def: 12, xp: 110, credits: 130, level: 5, ability: { name: "Neural Burn",  effect: { type: "burn",       turns: 4, value: 10 }, chance: 0.45 } },
  { name: "Megacorp AI",     hp: 200, atk: 35, def: 18, xp: 200, credits: 250, level: 7, boss: true,
    ability: { name: "System Purge", effect: { type: "burn", turns: 5, value: 15 }, chance: 0.60 } },
];

const GEAR = [
  { id: "deck1",  name: "Budget Deck",       atk: 2,  def: 0,  price: 50,  desc: "Barely runs your scripts." },
  { id: "deck2",  name: "Modded Cyberboard", atk: 5,  def: 1,  price: 120, desc: "Overclocked and overheating." },
  { id: "deck3",  name: "Zero-Day Arsenal",  atk: 10, def: 2,  price: 300, desc: "Fresh exploits, no patches." },
  { id: "armor1", name: "VPN Stack",         atk: 0,  def: 3,  price: 80,  desc: "Masks your trace signature." },
  { id: "armor2", name: "Ghost Protocol",    atk: 0,  def: 7,  price: 200, desc: "Military-grade anonymity." },
  { id: "armor3", name: "Neural Shield",     atk: 1,  def: 12, price: 400, desc: "Intercepts hostile packets." },
];

// Drinks from Lyra — one-fight buffs
const DRINKS = [
  { id: "stimpack",  name: "Stim-Splice",    price: 25, desc: "+5 ATK next fight",        buff: { stat: "atk",  val: 5  } },
  { id: "shieldpulse",name:"Shield Pulse",   price: 25, desc: "+5 DEF next fight",        buff: { stat: "def",  val: 5  } },
  { id: "overclock", name: "Overclock Shot", price: 40, desc: "+15% crit next fight",     buff: { stat: "crit", val: 0.15 } },
  { id: "fullrestore",name:"Neural Flush",   price: 60, desc: "Restore 50 HP",            buff: { stat: "hp",   val: 50  } },
];

const MAX_TURNS = 10;
const XP_PER_LEVEL = (lvl) => lvl * 80;
const MAX_INV_SLOTS = 8;
const MAX_STACK = 3;

// ─── CONSUMABLES ─────────────────────────────────────────────────────────────
// use(player, combatState) → { p, combatEffect, logEntry }
// combatEffect: { type: "atkBuff"|"defBuff"|"skipEnemy"|"iceBreakerDef", value, turns } | null

const CONSUMABLES = {
  stim_injector: {
    id: "stim_injector", name: "Stim Injector", icon: "💉", rarity: "common",
    desc: "Restore 30 HP instantly.", sellPrice: 15,
    useInHub: true, useInCombat: true,
    use: (p) => {
      const heal = Math.min(30, p.maxHp - p.hp);
      return { p: { ...p, hp: p.hp + heal }, combatEffect: null, log: `[STIM] Restored ${heal} HP` };
    }
  },
  overclock_chip: {
    id: "overclock_chip", name: "Overclock Chip", icon: "⚡", rarity: "uncommon",
    desc: "+8 ATK for 3 combat rounds.", sellPrice: 25,
    useInHub: false, useInCombat: true,
    use: (p) => ({ p, combatEffect: { type: "atkBuff", value: 8, turns: 3 }, log: `[OVERCLOCK] +8 ATK for 3 rounds` })
  },
  smoke_grenade: {
    id: "smoke_grenade", name: "Smoke Grenade", icon: "💨", rarity: "uncommon",
    desc: "Clear all your status effects.", sellPrice: 20,
    useInHub: true, useInCombat: true,
    use: (p) => ({ p: { ...p, statusEffects: [] }, combatEffect: null, log: `[SMOKE] All status effects cleared` })
  },
  ice_breaker: {
    id: "ice_breaker", name: "ICE Breaker", icon: "🔓", rarity: "rare",
    desc: "Halve enemy DEF for 2 rounds.", sellPrice: 40,
    useInHub: false, useInCombat: true,
    use: (p) => ({ p, combatEffect: { type: "iceBreakerDef", value: 0.5, turns: 2 }, log: `[ICE BREAKER] Enemy DEF halved for 2 rounds` })
  },
  neural_patch: {
    id: "neural_patch", name: "Neural Patch", icon: "🧠", rarity: "rare",
    desc: "Survive your next killing blow at 1 HP.", sellPrice: 60,
    useInHub: true, useInCombat: false,
    use: (p) => ({ p: { ...p, _deathShield: true }, combatEffect: null, log: `[NEURAL PATCH] Death shield active` })
  },
  black_market_key: {
    id: "black_market_key", name: "Black Market Key", icon: "🗝️", rarity: "uncommon",
    desc: "Instantly gain ₡80.", sellPrice: 35,
    useInHub: true, useInCombat: false,
    use: (p) => ({ p: { ...p, credits: p.credits + 80 }, combatEffect: null, log: `[KEY] ₡80 deposited` })
  },
  exploit_kit: {
    id: "exploit_kit", name: "Exploit Kit", icon: "🛠", rarity: "rare",
    desc: "Reset your ability cooldown to 0.", sellPrice: 45,
    useInHub: false, useInCombat: true,
    use: (p) => ({ p: { ...p, abilityCooldown: 0 }, combatEffect: null, log: `[EXPLOIT KIT] Ability cooldown reset` })
  },
  decoy_signal: {
    id: "decoy_signal", name: "Decoy Signal", icon: "📡", rarity: "uncommon",
    desc: "40% chance enemy skips their next attack.", sellPrice: 20,
    useInHub: false, useInCombat: true,
    use: (p) => ({ p, combatEffect: { type: "skipEnemy", value: 0.4, turns: 1 }, log: `[DECOY] Signal deployed — enemy may miss` })
  },
};

// Drop tables per enemy level tier
const DROP_TABLES = {
  1: ["stim_injector", "black_market_key", "decoy_signal"],
  2: ["stim_injector", "smoke_grenade", "overclock_chip", "black_market_key", "decoy_signal"],
  3: ["stim_injector", "smoke_grenade", "overclock_chip", "ice_breaker", "decoy_signal", "exploit_kit"],
  4: ["overclock_chip", "ice_breaker", "neural_patch", "exploit_kit", "smoke_grenade"],
  5: ["ice_breaker", "neural_patch", "exploit_kit", "overclock_chip"],
  7: ["neural_patch", "exploit_kit", "ice_breaker", "overclock_chip"], // boss
};

function rollDrop(enemyLevel, isBoss) {
  const chance = isBoss ? 1.0 : 0.30 + enemyLevel * 0.05;
  if (Math.random() > chance) return null;
  const tier = Math.min(enemyLevel, 7);
  const table = DROP_TABLES[tier] || DROP_TABLES[1];
  return table[Math.floor(Math.random() * table.length)];
}

function addToInventory(inventory, itemId) {
  const inv = [...(inventory || [])];
  const existing = inv.find(s => s.id === itemId);
  if (existing) {
    if (existing.qty < MAX_STACK) { existing.qty++; return { inv, added: true }; }
    return { inv, added: false }; // full stack
  }
  if (inv.length >= MAX_INV_SLOTS) return { inv, added: false }; // full bag
  inv.push({ id: itemId, qty: 1 });
  return { inv, added: true };
}

function removeFromInventory(inventory, itemId) {
  const inv = [...(inventory || [])];
  const idx = inv.findIndex(s => s.id === itemId);
  if (idx === -1) return inv;
  if (inv[idx].qty > 1) { inv[idx] = { ...inv[idx], qty: inv[idx].qty - 1 }; }
  else { inv.splice(idx, 1); }
  return inv;
}

// ─── DAILY QUESTS ────────────────────────────────────────────────────────────
// Each quest: id, label, desc, difficulty, goal (number), stat (tracked field),
// reward: { credits, xp, item? }
// progress tracked in player.quests[id].progress

const QUEST_POOL = [
  // ── COMBAT ──
  { id: "q_kill3",    cat: "COMBAT",      diff: "easy",   label: "First Blood",       desc: "Defeat 3 enemies on the grid.",               goal: 3,  stat: "kills",       reward: { credits: 50,  xp: 40  } },
  { id: "q_kill6",    cat: "COMBAT",      diff: "medium", label: "Kill Streak",       desc: "Defeat 6 enemies in a single day.",           goal: 6,  stat: "kills",       reward: { credits: 100, xp: 80,  item: "stim_injector" } },
  { id: "q_kill10",   cat: "COMBAT",      diff: "hard",   label: "Grid Reaper",       desc: "Defeat 10 enemies without mercy.",            goal: 10, stat: "kills",       reward: { credits: 200, xp: 150, item: "overclock_chip" } },
  { id: "q_crit3",    cat: "COMBAT",      diff: "easy",   label: "Critical Eye",      desc: "Land 3 critical hits.",                       goal: 3,  stat: "crits",       reward: { credits: 50,  xp: 40  } },
  { id: "q_crit8",    cat: "COMBAT",      diff: "medium", label: "Precision Strike",  desc: "Land 8 critical hits.",                       goal: 8,  stat: "crits",       reward: { credits: 100, xp: 80,  item: "overclock_chip" } },
  { id: "q_ability3", cat: "COMBAT",      diff: "easy",   label: "System Exploit",    desc: "Use your class ability 3 times.",             goal: 3,  stat: "abilityUses", reward: { credits: 60,  xp: 50  } },
  { id: "q_survive",  cat: "COMBAT",      diff: "medium", label: "Bulletproof",       desc: "Finish a fight with less than 20% HP.",       goal: 1,  stat: "lowHpWins",   reward: { credits: 120, xp: 90,  item: "neural_patch" } },
  // ── GRID ──
  { id: "q_events3",  cat: "GRID",        diff: "easy",   label: "Grid Walker",       desc: "Encounter 3 grid events.",                    goal: 3,  stat: "events",      reward: { credits: 50,  xp: 40  } },
  { id: "q_windfall", cat: "GRID",        diff: "easy",   label: "Lucky Signal",      desc: "Find 2 windfall events.",                     goal: 2,  stat: "windfalls",   reward: { credits: 70,  xp: 50  } },
  { id: "q_choice2",  cat: "GRID",        diff: "medium", label: "Decision Maker",    desc: "Complete 2 choice events.",                   goal: 2,  stat: "choices",     reward: { credits: 90,  xp: 70  } },
  { id: "q_runs5",    cat: "GRID",        diff: "medium", label: "Deep Diver",        desc: "Complete 5 grid runs.",                       goal: 5,  stat: "runs",        reward: { credits: 100, xp: 80,  item: "decoy_signal" } },
  { id: "q_jackout",  cat: "GRID",        diff: "easy",   label: "Live to Fight",     desc: "Jack out of combat 2 times.",                 goal: 2,  stat: "jackOuts",    reward: { credits: 50,  xp: 35  } },
  // ── PVP ──
  { id: "q_pvp1",     cat: "PVP",         diff: "easy",   label: "First Strike",      desc: "Win 1 PvP fight.",                            goal: 1,  stat: "pvpWins",     reward: { credits: 80,  xp: 60  } },
  { id: "q_pvp3",     cat: "PVP",         diff: "hard",   label: "Grid Predator",     desc: "Win 3 PvP fights in one day.",                goal: 3,  stat: "pvpWins",     reward: { credits: 200, xp: 150, item: "ice_breaker" } },
  { id: "q_bounty1",  cat: "PVP",         diff: "medium", label: "Debt Collector",    desc: "Collect 1 bounty from your list.",            goal: 1,  stat: "bountiesCollected", reward: { credits: 150, xp: 100, item: "exploit_kit" } },
  { id: "q_pvpatt2",  cat: "PVP",         diff: "easy",   label: "Aggressor",         desc: "Attack 2 runners (win or lose).",             goal: 2,  stat: "pvpAttempts", reward: { credits: 60,  xp: 45  } },
  // ── ECONOMY ──
  { id: "q_earn300",  cat: "ECONOMY",     diff: "medium", label: "Credit Farmer",     desc: "Earn ₡300 from combat.",                      goal: 300,stat: "creditsEarned",reward: { credits: 100, xp: 70  } },
  { id: "q_earn600",  cat: "ECONOMY",     diff: "hard",   label: "Rich Runner",       desc: "Earn ₡600 from combat.",                      goal: 600,stat: "creditsEarned",reward: { credits: 200, xp: 140, item: "black_market_key" } },
  { id: "q_buy1",     cat: "ECONOMY",     diff: "easy",   label: "Market Regular",    desc: "Buy 1 item from the Black Market.",           goal: 1,  stat: "gearBought",  reward: { credits: 50,  xp: 35  } },
  { id: "q_sell2",    cat: "ECONOMY",     diff: "easy",   label: "Fence",             desc: "Sell 2 consumables.",                         goal: 2,  stat: "itemsSold",   reward: { credits: 60,  xp: 40  } },
  // ── EXPLORATION ──
  { id: "q_use2",     cat: "EXPLORE",     diff: "easy",   label: "Field Medic",       desc: "Use 2 consumable items.",                     goal: 2,  stat: "itemsUsed",   reward: { credits: 50,  xp: 40  } },
  { id: "q_loot3",    cat: "EXPLORE",     diff: "medium", label: "Scavenger",         desc: "Pick up 3 loot drops.",                       goal: 3,  stat: "lootPicked",  reward: { credits: 80,  xp: 60,  item: "smoke_grenade" } },
  { id: "q_status",   cat: "EXPLORE",     diff: "medium", label: "Status Junkie",     desc: "Cure a status effect 2 times.",               goal: 2,  stat: "statusCured", reward: { credits: 90,  xp: 65  } },
];

const DIFF_COLORS = { easy: "#00ff9f", medium: "#facc15", hard: "#ff2d7a" };
const QUESTS_PER_DAY = 3;

function generateDailyQuests(dateStr, playerCls) {
  // Seed selection from date string so everyone gets same pool on same day
  let seed = dateStr.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const rng = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  // One from each difficulty
  const easy   = QUEST_POOL.filter(q => q.diff === "easy");
  const medium = QUEST_POOL.filter(q => q.diff === "medium");
  const hard   = QUEST_POOL.filter(q => q.diff === "hard");
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return [pick(easy), pick(medium), pick(hard)].map(q => ({
    id: q.id, progress: 0, claimed: false,
  }));
}

function getQuestDef(id) { return QUEST_POOL.find(q => q.id === id); }

function advanceQuest(quests, stat, amount = 1) {
  if (!quests) return quests;
  return quests.map(q => {
    const def = getQuestDef(q.id);
    if (!def || def.stat !== stat || q.claimed) return q;
    return { ...q, progress: Math.min(q.progress + amount, def.goal) };
  });
}
// Each event: id, type, label, icon, weight, choices[], resolve(choice, player)
// resolve returns { p (mutated player), outcome: string, tag: string }
// tag used in narration prompt. choices = [{id,label}] — single choice = auto-resolve

const GRID_EVENTS = [
  // ── WINDFALLS ──
  {
    id: "lost_wallet", type: "windfall", icon: "₡", label: "Abandoned Cache",
    weight: 10,
    prompt: (p) => `${p.name} stumbles across an abandoned credit cache floating in an unmonitored subnet. Describe the discovery in 2 sentences.`,
    choices: [{ id: "take", label: "◈ Grab the credits" }],
    resolve: (choice, p) => {
      const gain = 20 + Math.floor(Math.random() * 40);
      return { p: { ...p, credits: p.credits + gain }, tag: `gained ₡${gain} from abandoned cache`, detail: `+₡${gain}` };
    }
  },
  {
    id: "data_shard", type: "windfall", icon: "◈", label: "Corrupted Data Shard",
    weight: 8,
    prompt: (p) => `${p.name} finds a corrupted data shard drifting through a dead node. It pulses with residual rep data. Describe it in 2 sentences.`,
    choices: [{ id: "jack", label: "◈ Jack into the shard" }],
    resolve: (choice, p) => {
      const gain = 25 + Math.floor(Math.random() * 35) + p.level * 5;
      return { p: { ...p, xp: p.xp + gain }, tag: `absorbed data shard for ${gain} XP`, detail: `+${gain} XP` };
    }
  },
  {
    id: "friendly_runner", type: "windfall", icon: "◇", label: "Friendly Runner",
    weight: 6,
    prompt: (p) => `A runner going by the handle "VASH" slides ${p.name} a pirated exploit pack with a nod — no strings, just grid solidarity. Describe the handoff in 2 sentences.`,
    choices: [{ id: "accept", label: "◇ Accept the gift" }],
    resolve: (choice, p) => {
      const newBuff = { stat: "atk", val: 6 };
      return { p: { ...p, nextFightBuff: newBuff }, tag: "received pirated exploit pack — ATK buffed next fight", detail: "+6 ATK (next fight)" };
    }
  },

  // ── TRAPS ──
  {
    id: "honeypot", type: "trap", icon: "⚠", label: "Honeypot Node",
    weight: 9,
    prompt: (p) => `${p.name} jacks into what looks like a free credit node — too late, it's a corp honeypot. Alarms cascade. Describe the trap springing in 2 sentences.`,
    choices: [{ id: "suffer", label: "⚠ Take the hit" }],
    resolve: (choice, p) => {
      const loss = 15 + Math.floor(Math.random() * 25);
      const actual = Math.min(loss, p.credits);
      return { p: { ...p, credits: Math.max(0, p.credits - actual) }, tag: `hit a honeypot, lost ₡${actual}`, detail: `-₡${actual}` };
    }
  },
  {
    id: "ice_spike", type: "trap", icon: "⚠", label: "ICE Spike",
    weight: 9,
    prompt: (p) => `A dormant ICE spike activates and slams ${p.name}'s signal, punching straight through their defenses. Describe the impact in 2 sentences.`,
    choices: [{ id: "endure", label: "⚠ Endure the damage" }],
    resolve: (choice, p) => {
      const dmg = 10 + Math.floor(Math.random() * 20);
      const actual = Math.min(dmg, p.hp - 1);
      return { p: { ...p, hp: Math.max(1, p.hp - actual) }, tag: `hit by ICE spike for ${actual} damage`, detail: `-${actual} HP` };
    }
  },
  {
    id: "trace_alert", type: "trap", icon: "⚠", label: "Trace Alert",
    weight: 7,
    prompt: (p) => `Corp trace algorithms lock onto ${p.name}'s signal signature — tagged and TRACED before they can mask. Describe the alert in 2 sentences.`,
    choices: [{ id: "endure", label: "⚠ Try to shake it" }],
    resolve: (choice, p) => {
      const traced = { type: "traced", turns: 2, value: 3 };
      const effects = [...(p.statusEffects || []).filter(s => s.type !== "traced"), traced];
      return { p: { ...p, statusEffects: effects }, tag: "got traced — DEF reduced for 2 turns", detail: "TRACED ×2" };
    }
  },

  // ── CHOICES ──
  {
    id: "dying_runner", type: "choice", icon: "◇", label: "Dying Runner",
    weight: 8,
    prompt: (p, choice) => choice === "help"
      ? `${p.name} shares resources with a dying runner bleeding out in the grid. The runner whispers a grateful thanks and slips them something valuable. Describe this in 2 sentences.`
      : `${p.name} walks past the dying runner, not their problem. Describe this cold decision in 1 sentence.`,
    choices: [
      { id: "help",   label: "◇ Help them (−20 HP)" },
      { id: "ignore", label: "⚠ Walk past" },
    ],
    resolve: (choice, p) => {
      if (choice === "help") {
        const xpGain = 30 + Math.floor(Math.random() * 20);
        const hpCost = Math.min(20, p.hp - 1);
        return { p: { ...p, hp: p.hp - hpCost, xp: p.xp + xpGain }, tag: `helped a dying runner, lost ${hpCost} HP but gained ${xpGain} XP`, detail: `-${hpCost} HP / +${xpGain} XP` };
      }
      return { p, tag: "ignored a dying runner — no cost, no reward", detail: "Nothing gained" };
    }
  },
  {
    id: "fixer_deal", type: "choice", icon: "₡", label: "Fixer's Offer",
    weight: 8,
    prompt: (p, choice) => choice === "take"
      ? `${p.name} takes a shady data courier job from a fixer named MOTH — fast credits, no questions. Describe the handshake in 2 sentences.`
      : `${p.name} turns down MOTH's offer. The fixer shrugs and fades into the subnet. Describe in 1 sentence.`,
    choices: [
      { id: "take",   label: "₡ Take the job (+₡50, −15 HP)" },
      { id: "refuse", label: "◇ Decline" },
    ],
    resolve: (choice, p) => {
      if (choice === "take") {
        const hpCost = Math.min(15, p.hp - 1);
        return { p: { ...p, credits: p.credits + 50, hp: p.hp - hpCost }, tag: `took MOTH's job — earned ₡50 but took ${hpCost} damage`, detail: `+₡50 / -${hpCost} HP` };
      }
      return { p, tag: "declined the fixer's offer", detail: "Passed" };
    }
  },
  {
    id: "corp_drone", type: "choice", icon: "⚠", label: "Corp Scan Drone",
    weight: 7,
    prompt: (p, choice) => choice === "bribe"
      ? `${p.name} bribes the corp scan drone with a fat credit packet. It rotates away, indifferent. Describe in 1 sentence.`
      : `${p.name} tries to outrun the corp scan drone's trace beam. Describe the chase in 2 sentences.`,
    choices: [
      { id: "bribe", label: "₡ Bribe it (−30₡)" },
      { id: "run",   label: "◇ Make a run for it" },
    ],
    resolve: (choice, p) => {
      if (choice === "bribe") {
        const cost = Math.min(30, p.credits);
        return { p: { ...p, credits: p.credits - cost }, tag: `bribed a scan drone for ₡${cost}`, detail: `-₡${cost}` };
      }
      // 50/50 — escape clean or get traced
      if (Math.random() > 0.5) {
        return { p, tag: "outran the corp drone — clean escape", detail: "Clean escape" };
      }
      const traced = { type: "traced", turns: 3, value: 4 };
      const effects = [...(p.statusEffects || []).filter(s => s.type !== "traced"), traced];
      return { p: { ...p, statusEffects: effects }, tag: "couldn't outrun the drone — TRACED for 3 turns", detail: "TRACED ×3" };
    }
  },
  {
    id: "glitch_node", type: "choice", icon: "◈", label: "Glitched Node",
    weight: 7,
    prompt: (p, choice) => choice === "probe"
      ? `${p.name} probes a violently glitching node — unpredictable, dangerous, possibly lucrative. Describe what happens in 2 sentences.`
      : `${p.name} steers clear of the glitching node. Smart. Describe in 1 sentence.`,
    choices: [
      { id: "probe", label: "◈ Probe the node (risky)" },
      { id: "avoid", label: "◇ Avoid it" },
    ],
    resolve: (choice, p) => {
      if (choice === "probe") {
        const roll = Math.random();
        if (roll < 0.33) {
          const gain = 60 + Math.floor(Math.random() * 60);
          return { p: { ...p, credits: p.credits + gain }, tag: `probed the glitch node — jackpot, gained ₡${gain}`, detail: `+₡${gain}` };
        } else if (roll < 0.66) {
          const xp = 40 + Math.floor(Math.random() * 40);
          return { p: { ...p, xp: p.xp + xp }, tag: `probed the glitch node — strange data, gained ${xp} XP`, detail: `+${xp} XP` };
        } else {
          const dmg = Math.min(25, p.hp - 1);
          return { p: { ...p, hp: p.hp - dmg }, tag: `probed the glitch node — it blew back, took ${dmg} damage`, detail: `-${dmg} HP` };
        }
      }
      return { p, tag: "avoided the glitch node", detail: "Passed safely" };
    }
  },

  // ── CLASS-SPECIFIC ──
  {
    id: "ghost_shortcut", type: "windfall", icon: "◇", label: "Ghost Lane",
    weight: 5, classOnly: "ghost",
    prompt: (p) => `${p.name}'s Ghost instincts kick in — a hidden bypass route through the grid no one else can see. The path shimmers with unpatched shadow-data. Describe in 2 sentences.`,
    choices: [{ id: "take", label: "◇ Take the ghost lane" }],
    resolve: (choice, p) => {
      const def = 5;
      return { p: { ...p, nextFightBuff: { stat: "def", val: def } }, tag: "found a ghost lane — DEF buffed next fight", detail: `+${def} DEF (next fight)` };
    }
  },
  {
    id: "brute_fight", type: "windfall", icon: "◆", label: "Back-Alley Bout",
    weight: 5, classOnly: "bruteforcer",
    prompt: (p) => `Another runner spots ${p.name}'s brutal rep and challenges them to a quick back-alley bout for bragging rights. No ICE, just raw power. Describe in 2 sentences.`,
    choices: [{ id: "fight", label: "◆ Throw down" }],
    resolve: (choice, p) => {
      const xp = 20 + Math.floor(Math.random() * 20);
      const credits = 25 + Math.floor(Math.random() * 25);
      return { p: { ...p, xp: p.xp + xp, credits: p.credits + credits }, tag: `won back-alley bout, earned ${xp} XP and ₡${credits}`, detail: `+${xp} XP / +₡${credits}` };
    }
  },
  {
    id: "netrunner_exploit", type: "windfall", icon: "◈", label: "Zero-Day Cache",
    weight: 5, classOnly: "netrunner",
    prompt: (p) => `${p.name}'s scanner pings an unpatched corp server — a fresh zero-day just sitting there, unguarded. Describe the discovery in 2 sentences.`,
    choices: [{ id: "exploit", label: "◈ Exploit it" }],
    resolve: (choice, p) => {
      const cd = Math.max(0, p.abilityCooldown - 2);
      const xp = 20 + Math.floor(Math.random() * 20);
      return { p: { ...p, abilityCooldown: cd, xp: p.xp + xp }, tag: `exploited a zero-day cache — ability cooldown reduced, +${xp} XP`, detail: `CD -2 / +${xp} XP` };
    }
  },
];

function pickGridEvent(player) {
  // Filter by class restriction, then weighted random
  const eligible = GRID_EVENTS.filter(e => !e.classOnly || e.classOnly === player.cls);
  const total = eligible.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of eligible) { r -= e.weight; if (r <= 0) return e; }
  return eligible[eligible.length - 1];
}
const SAFEMODE_COST = 50;
const SAFEMODE_HOURS = 24;
const PVP_STEAL_PCT = 0.25;   // winner steals 25% of loser's credits
const PVP_BOUNTY_BONUS = 1.5; // bounty targets give 50% more credits

const RUNNER_HANDLES = [
  "VASH","MOTH","CIPHER","NULL_PTR","KR0NOS","SPECTER","GLITCH","R4ZERWIRE",
  "PHANTASM","DEADSEC","AXIOM","V0ID","SABLE","HEXLINE","NOCTURN","FAULTLINE",
  "PARADOX","WRAITHX","BURNOUT","SHELLCODE",
];
const RUNNER_TAUNTS = [
  "Your exploits are already patched, rookie.",
  "I've flatlined runners twice your rank.",
  "The grid doesn't forget — and neither do I.",
  "You're just XP waiting to happen.",
  "I traced your signal before you even jacked in.",
  "Last runner who came for me is still loading.",
  "Bold of you to think your deck can touch mine.",
  "Signal locked. This'll be quick.",
];

function generateRunners(playerLevel) {
  const handles = [...RUNNER_HANDLES].sort(() => Math.random() - 0.5).slice(0, 8);
  return handles.map((handle, i) => {
    const clsKeys = Object.keys(CLASSES);
    const cls = clsKeys[Math.floor(Math.random() * clsKeys.length)];
    const base = CLASSES[cls];
    const lvlRange = Math.max(1, playerLevel + Math.floor(Math.random() * 5) - 2);
    const lvl = Math.max(1, lvlRange);
    const atk = base.atk + lvl * 2 + Math.floor(Math.random() * 4);
    const def = base.def + lvl + Math.floor(Math.random() * 3);
    const maxHp = base.hp + lvl * 15;
    return {
      id: `runner_${i}`,
      handle,
      cls,
      level: lvl,
      atk, def,
      hp: maxHp, maxHp,
      credits: 50 + lvl * 30 + Math.floor(Math.random() * 80),
      taunt: RUNNER_TAUNTS[Math.floor(Math.random() * RUNNER_TAUNTS.length)],
      wins: Math.floor(Math.random() * lvl * 3),
      losses: Math.floor(Math.random() * lvl),
      isBounty: false,
      safeMode: Math.random() < 0.15, // 15% are in safe mode
    };
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function loadState() {
  try { const s = localStorage.getItem("netrunner_v3"); return s ? JSON.parse(s) : null; } catch { return null; }
}
function saveState(s) { localStorage.setItem("netrunner_v3", JSON.stringify(s)); }

function newPlayer(name, cls) {
  const base = CLASSES[cls];
  return {
    name, cls,
    hp: base.hp, maxHp: base.hp,
    atk: base.atk, def: base.def,
    level: 1, xp: 0, credits: 150,
    gear: [], turnsLeft: MAX_TURNS,
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
    loginStreak: 0,
    longestStreak: 0,
    lastLoginDate: null,
    loginHistory: [],
    badges: [],
    dungeonTitles: [],
    dungeonsCleared: [],
    rep: 0,
    gridRating: { entertainment: 0, threat: 0, survival: 0 },
    sponsor: null,
    lastSponsorMsg: null,
    interventionPending: null,
    inCollective: false,
    collectiveCycle: null,
    carePackagesSent: 0,
    lastFlirtDate: null,
    lyraMarried: false,
    lyraFreedrinks: false,
  };
}

function getEnemyForLevel(playerLevel) {
  const eligible = ENEMIES.filter(e => e.level <= playerLevel + 1);
  const e = { ...eligible[Math.floor(Math.random() * eligible.length)] };
  return { ...e, currentHp: e.hp, statusEffects: [] };
}

function calcAtk(player) {
  let base = player.atk + player.gear.reduce((s, id) => { const g = GEAR.find(g => g.id === id); return s + (g?.atk || 0); }, 0);
  if (player.nextFightBuff?.stat === "atk") base += player.nextFightBuff.val;
  const ol = (player.statusEffects || []).find(s => s.type === "overloaded");
  if (ol) base = Math.max(1, base - ol.value);
  return base;
}
function calcDef(player) {
  let base = player.def + player.gear.reduce((s, id) => { const g = GEAR.find(g => g.id === id); return s + (g?.def || 0); }, 0);
  if (player.nextFightBuff?.stat === "def") base += player.nextFightBuff.val;
  const tr = (player.statusEffects || []).find(s => s.type === "traced");
  if (tr && !player._immuneTraced) base = Math.max(0, base - tr.value);
  return base;
}
function calcCrit(player) {
  let base = CLASSES[player.cls].critChance + (player._critBonus || 0);
  if (player.nextFightBuff?.stat === "crit") base += player.nextFightBuff.val;
  return base;
}
function calcCritMult(player) { return player._critMult || 2; }
function calcAbilityCooldown(player, baseCd) {
  return Math.max(1, baseCd + (player._abilityBonus || 0));
}
function calcEnemyAtk(e) {
  let base = e.atk;
  const ol = (e.statusEffects || []).find(s => s.type === "overloaded");
  if (ol) base = Math.max(1, base - ol.value);
  return base;
}
function calcEnemyDef(e) {
  let base = e.def;
  const tr = (e.statusEffects || []).find(s => s.type === "traced");
  if (tr) base = Math.max(0, base - tr.value);
  return base;
}
function tickStatuses(arr) { return arr.map(s => ({ ...s, turns: s.turns - 1 })).filter(s => s.turns > 0); }
function burnDmg(arr) { const b = arr.find(s => s.type === "burn"); return b ? b.value : 0; }
function isSafeModeActive(player) {
  if (!player.safeModeUntil) return false;
  return new Date(player.safeModeUntil) > new Date();
}
function safeModeRemaining(player) {
  if (!player.safeModeUntil) return null;
  const diff = new Date(player.safeModeUntil) - new Date();
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

// ─── NARRATION ───────────────────────────────────────────────────────────────

async function getNarration(prompt) {
  try {
    const res = await fetch("/api/narrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    return data.text || "// Signal lost.";
  } catch {
    return "// ERROR: Signal fragmented.";
  }
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;700&display=swap');
  *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }

  :root {
    /* Strict CGA/EGA 16-color palette */
    --black:    #000000;
    --dgray:    #777777;  /* raised from #555 — much more readable */
    --blue:     #0000aa;
    --lblue:    #5555ff;
    --green:    #00aa00;
    --lgreen:   #55ff55;
    --cyan:     #00aaaa;
    --lcyan:    #55ffff;
    --red:      #aa0000;
    --lred:     #ff5555;
    --magenta:  #aa00aa;
    --lmagenta: #ff55ff;
    --brown:    #aa5500;
    --yellow:   #ffff55;
    --lgray:    #cccccc;  /* raised from #aaa — better for body text */
    --white:    #ffffff;

    /* Semantic mappings */
    --bg:        #0d0d0d;  /* slightly off-black — easier on eyes */
    --bg2:       #141414;
    --bg3:       #1a1a1a;
    --text:      var(--lgreen);
    --text-dim:  var(--dgray);
    --text-bright: var(--white);
    --border:    var(--green);
    --border-dim: #444444;
    --accent:    var(--lcyan);
    --danger:    var(--lred);
    --warn:      var(--yellow);
    --credits:   var(--yellow);
    --lyra:      var(--lmagenta);
    --static:    var(--lcyan);
    --scan:      rgba(0,255,0,0.012);
  }

  body {
    background: var(--bg);
    color: var(--lgray);   /* default text is now #ccc not green — green is for highlights */
    font-family: 'IBM Plex Mono', 'Courier New', monospace;
    font-size: 15px;       /* up from 14px */
    line-height: 1.6;      /* up from 1.4 — much more readable */
    min-height: 100vh;
    overflow-x: hidden;
  }

  /* CRT phosphor overlay */
  .crt { position:relative; min-height:100vh; }
  .crt::before {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:9999;
    background: repeating-linear-gradient(0deg, transparent, transparent 1px, var(--scan) 1px, var(--scan) 2px);
  }
  .crt::after {
    content:''; position:fixed; inset:0; pointer-events:none; z-index:9998;
    background: radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.4) 100%);
  }

  .app { max-width: 750px; margin: 0 auto; padding: 10px 14px; }

  /* ── PANELS ── */
  .panel { background:var(--bg2); border:1px solid #2a2a2a; padding:12px 14px; margin-bottom:10px; }
  .panel-title { font-size:13px; letter-spacing:.22em; color:var(--dgray); text-transform:uppercase; margin-bottom:10px; border-bottom:1px solid #222; padding-bottom:6px; }

  /* ── TYPOGRAPHY ── */
  .dim { color:var(--dgray); }        /* #777 — readable */
  .credits { color:var(--yellow); font-size:14px; }
  .mb-8  { margin-bottom:8px; }
  .mb-12 { margin-bottom:12px; }
  .mt-8  { margin-top:8px; }
  .mt-12 { margin-top:12px; }
  .flex-between { display:flex; justify-content:space-between; align-items:center; }
  .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .grid-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
  .action-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:8px; }
  .btn-full { width:100%; }

  /* ── ANSI TITLE ── */
  .ansi-header-wrap { width:100%; overflow:hidden; }
  .ansi-header-wrap { width:100%; overflow:hidden; }
  .ansi-title {
    font-family: 'IBM Plex Mono', monospace;
    white-space: pre;
    line-height: 1.15;
    font-size: clamp(7px, 1.6vw, 14px);
    margin-bottom: 4px;
    text-align: center;
    width: 100%;
    display: block;
    margin: 0 auto;
  }
  .header {
    text-align: center;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--green);
  }
  .tagline { font-size:13px; color:var(--dgray); letter-spacing:.2em; margin-top:4px; }
  .bbs-info { font-size:13px; color:var(--dgray); margin-top:2px; }

  /* ── BOX DRAWING ── */
  .box {
    border: none;
    margin-bottom: 10px;
    position: relative;
  }
  .box-inner { padding: 6px 10px; }
  .box-top { color: var(--lgreen); font-size: 13px; white-space: pre; line-height: 1; display: block; }
  .box-mid { color: var(--lgreen); font-size: 13px; white-space: pre; line-height: 1; display: block; }
  .box-bot { color: var(--lgreen); font-size: 13px; white-space: pre; line-height: 1; display: block; }
  .box-title {
    color: var(--lcyan);
    font-size: 11px;
    letter-spacing: .2em;
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  /* Legacy panel alias → box style */
  .panel {
    background: var(--black);
    border: 1px solid var(--green);
    padding: 8px 10px;
    margin-bottom: 10px;
    position: relative;
  }
  .panel-title {
    color: var(--lcyan);
    font-size: 11px;
    letter-spacing: .2em;
    text-transform: uppercase;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--dgray);
    padding-bottom: 4px;
  }

  /* ── GRIDS ── */
  .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  @media(max-width:560px){ .grid-2{grid-template-columns:1fr} .grid-3{grid-template-columns:1fr} }

  /* ── STAT BARS (ASCII style) ── */
  .stat-row { display:flex; align-items:center; gap:8px; margin-bottom:5px; font-size:14px; }
  .stat-label { color:var(--lgray); width:80px; flex-shrink:0; font-size:14px; }
  .bar-track { flex:1; height:14px; background:var(--bg2); border:1px solid #444; overflow:hidden; position:relative; font-size:13px; line-height:14px; }
  .bar-fill { height:100%; transition:width .2s; display:flex; align-items:center; }
  .bar-hp   { background:var(--green); }
  .bar-xp   { background:var(--blue); }
  .bar-fill::after { content:''; }
  .stat-val { color:var(--lgreen); width:58px; text-align:right; font-size:13px; }

  /* ── BUTTONS — BBS menu style ── */
  .btn {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 12px;
    padding: 4px 14px;
    border: 1px solid var(--lgreen);
    background: var(--black);
    color: var(--lgreen);
    cursor: pointer;
    letter-spacing: .05em;
    text-transform: uppercase;
    transition: background .08s, color .08s;
    display: inline-flex; align-items:center; justify-content:center; gap:6px;
  }
  .btn:hover:not(:disabled) { background:var(--lgreen); color:var(--black); }
  .btn:disabled { opacity:.3; cursor:not-allowed; }

  .btn-danger  { border-color:var(--lred);     color:var(--lred); }
  .btn-danger:hover:not(:disabled)  { background:var(--lred);  color:var(--black); }
  .btn-cyan    { border-color:var(--lcyan);    color:var(--lcyan); }
  .btn-cyan:hover:not(:disabled)    { background:var(--lcyan);  color:var(--black); }
  .btn-purple  { border-color:var(--lmagenta); color:var(--lmagenta); }
  .btn-purple:hover:not(:disabled)  { background:var(--lmagenta); color:var(--black); }
  .btn-orange  { border-color:var(--yellow);   color:var(--yellow); }
  .btn-orange:hover:not(:disabled)  { background:var(--yellow);  color:var(--black); }
  .btn-lyra    { border-color:var(--lmagenta); color:var(--lmagenta); }
  .btn-lyra:hover:not(:disabled)    { background:var(--lmagenta); color:var(--black); }
  .btn-static  { border-color:var(--lcyan);    color:var(--lcyan); }
  .btn-static:hover:not(:disabled)  { background:var(--lcyan);   color:var(--black); }
  .btn-full { width:100%; }
  .btn-sm { padding:2px 10px; font-size:13px; }

  .action-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; }
  @media(max-width:500px){ .action-grid{grid-template-columns:1fr 1fr} }

  /* ── NARRATION — typewriter terminal ── */
  .narration {
    background: var(--black);
    border: 1px solid var(--green);
    border-left: 3px solid var(--lgreen);
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--lgreen);
    min-height: 52px;
    margin-bottom: 10px;
    white-space: pre-wrap;
    position: relative;
  }
  .narration::before { content:'> '; color:var(--dgray); }
  .narration.loading { color:var(--dgray); }
  .cursor { display:inline-block; width:9px; height:13px; background:var(--lgreen); animation:blink .7s infinite; vertical-align:middle; margin-left:2px; }
  @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }

  /* ── NPC BUBBLES ── */
  .bubble { border:1px solid; padding:8px 12px; margin-bottom:8px; font-size:14px; line-height:1.9; }
  .bubble.lyra   { border-color:var(--lmagenta); color:var(--lmagenta); }
  .bubble.static { border-color:var(--lcyan);    color:var(--lcyan);    }
  .bubble-speaker { font-size:12px; letter-spacing:.2em; margin-bottom:4px; opacity:.8; }

  /* ── REFUGE SCENE ── */
  .refuge-scene { border:1px solid #333; padding:8px 12px; margin-bottom:10px; font-size:13px; color:var(--dgray); line-height:1.9; }
  .refuge-title { color:var(--lcyan); letter-spacing:.15em; margin-bottom:6px; font-size:14px; }
  .npc-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid var(--dgray); }
  .npc-row:last-child { border-bottom:none; }
  .npc-avatar { width:32px; height:32px; display:flex; align-items:center; justify-content:center; font-size:16px; flex-shrink:0; border:1px solid; }
  .npc-info { flex:1; }
  .npc-name { font-size:14px; letter-spacing:.08em; }
  .npc-tagline { font-size:13px; color:var(--dgray); margin-top:2px; }

  /* ── SAFE MODE ── */
  .safemode-banner { border:1px solid var(--lcyan); background:var(--black); padding:6px 12px; margin-bottom:10px; display:flex; align-items:center; gap:8px; font-size:14px; color:var(--lcyan); }

  /* ── ENEMY CARD ── */
  .enemy-card { border:1px solid var(--lred); padding:10px; background:var(--black); }
  .enemy-name { font-size:13px; color:var(--lred); margin-bottom:8px; letter-spacing:.05em; }
  .boss-tag { font-size:11px; background:var(--lred); color:var(--black); padding:1px 5px; margin-left:6px; letter-spacing:.15em; vertical-align:middle; }

  /* ── COMBAT LOG ── */
  .combat-log { font-size:13px; color:var(--lgray); max-height:120px; overflow-y:auto; line-height:1.9; border:1px solid var(--dgray); padding:4px 8px; background:var(--black); }
  .combat-log .hit    { color:var(--lgreen);   }
  .combat-log .crit   { color:var(--white);    font-weight:bold; }
  .combat-log .dmg    { color:var(--lred);     }
  .combat-log .burn   { color:var(--yellow);   }
  .combat-log .status { color:var(--yellow);   }
  .combat-log .ability{ color:var(--lcyan);    }
  .combat-log .sys    { color:var(--lgray);    }

  /* ── STATUS CHIPS ── */
  .status-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
  .status-chip { font-size:12px; padding:1px 6px; letter-spacing:.08em; border:1px solid; }
  .buff-chip { font-size:12px; padding:1px 6px; letter-spacing:.08em; border:1px solid var(--lcyan); color:var(--lcyan); }

  /* ── CLASS CARDS ── */
  .class-card { border:1px solid var(--dgray); padding:10px; cursor:pointer; transition:border-color .1s; }
  .class-card:hover,.class-card.selected { border-color:var(--lgreen); background:#001100; }
  .class-icon { font-size:22px; margin-bottom:6px; display:block; }
  .class-name { font-size:14px; margin-bottom:4px; font-weight:700; letter-spacing:.05em; }
  .class-desc { font-size:13px; color:var(--dgray); line-height:1.9; }

  /* ── GEAR ── */
  .gear-item { border:1px solid var(--dgray); padding:8px 10px; display:flex; align-items:center; gap:8px; transition:border-color .1s; margin-bottom:6px; }
  .gear-item:hover { border-color:var(--lgreen); }
  .gear-item.owned { border-color:var(--green); opacity:.5; }
  .gear-info { flex:1; }
  .gear-name { font-size:14px; color:var(--lgreen); }
  .gear-desc { font-size:13px; color:var(--dgray); margin-top:2px; }
  .gear-stats{ font-size:13px; color:var(--lcyan); margin-top:2px; }
  .gear-price{ font-size:14px; color:var(--yellow); flex-shrink:0; }

  /* ── TABS — BBS menu style ── */
  .tabs { display:flex; gap:0; border-bottom:1px solid var(--green); margin-bottom:12px; overflow-x:auto; }
  .tab {
    font-family:'IBM Plex Mono',monospace; font-size:13px; padding:4px 12px;
    background:var(--black); border:none; color:var(--dgray); cursor:pointer;
    letter-spacing:.1em; text-transform:uppercase;
    border-bottom:2px solid transparent; transition:all .1s; white-space:nowrap;
  }
  .tab.active { color:var(--lgreen); border-bottom-color:var(--lgreen); background:#001100; }
  .tab:hover:not(.active) { color:var(--lgray); }

  /* ── INPUT ── */
  .input {
    font-family:'IBM Plex Mono',monospace; font-size:13px; padding:6px 10px;
    background:var(--black); border:1px solid var(--green); color:var(--lgreen);
    outline:none; width:100%;
  }
  .input:focus { border-color:var(--lgreen); }
  .input::placeholder { color:var(--dgray); }

  /* ── ABILITY BOX ── */
  .ability-box { border:1px solid; padding:8px 10px; margin-top:8px; }
  .ability-name { font-size:13px; letter-spacing:.12em; margin-bottom:3px; }
  .ability-desc { font-size:13px; color:var(--lgray); line-height:1.9; }
  .cd-badge { font-size:12px; padding:1px 6px; display:inline-block; margin-top:4px; border:1px solid; }

  /* ── DRINKS ── */
  .drink-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  @media(max-width:480px){ .drink-grid{grid-template-columns:1fr} }
  .drink-card { border:1px solid var(--dgray); padding:8px 10px; transition:border-color .1s; }
  .drink-card:hover { border-color:var(--lmagenta); }
  .drink-name { font-size:14px; color:var(--lmagenta); margin-bottom:2px; }
  .drink-desc { font-size:13px; color:var(--dgray); }
  .drink-price{ font-size:14px; color:var(--yellow); margin-top:4px; }

  /* ── RUNNER CARDS (PVP) ── */
  .runner-card { border:1px solid var(--dgray); padding:8px 10px; margin-bottom:6px; transition:border-color .1s; }
  .runner-card:hover { border-color:var(--lred); }
  .runner-card.safe { opacity:.4; }
  .runner-card.bounty { border-color:var(--yellow); }
  .runner-handle { font-size:14px; letter-spacing:.06em; }
  .runner-taunt  { font-size:13px; color:var(--dgray); font-style:italic; margin:3px 0 6px; line-height:1.9; }
  .runner-stats  { font-size:13px; color:var(--dgray); display:flex; gap:10px; flex-wrap:wrap; }
  .runner-stats span { color:var(--lgray); }
  .pvp-result { border:1px solid; padding:10px; margin-bottom:10px; }
  .pvp-result.win  { border-color:var(--lgreen); color:var(--lgreen); }
  .pvp-result.lose { border-color:var(--lred);   color:var(--lred);   }
  .pvp-log { font-size:13px; max-height:140px; overflow-y:auto; line-height:1.8; color:var(--dgray); }
  .pvp-log .hit  { color:var(--lgreen); }
  .pvp-log .crit { color:var(--white); }
  .pvp-log .dmg  { color:var(--lred);  }
  .pvp-log .sys  { color:var(--lgray); }
  .pvp-log .burn { color:var(--yellow);}
  .pvp-record { font-size:13px; color:var(--dgray); }
  .pvp-record span { color:var(--lgreen); }
  .pvp-record .loss { color:var(--lred); }

  /* ── SKILL TREE ── */
  .perk-modal { position:fixed; inset:0; background:rgba(0,0,0,.92); z-index:1000; display:flex; align-items:center; justify-content:center; padding:12px; }
  .perk-modal-inner { background:var(--black); border:1px solid var(--lgreen); max-width:600px; width:100%; padding:16px; max-height:90vh; overflow-y:auto; }
  .perk-modal-title { font-size:13px; color:var(--lgreen); letter-spacing:.15em; margin-bottom:3px; }
  .perk-modal-sub { font-size:13px; color:var(--dgray); margin-bottom:14px; }
  .perk-path-label { font-size:12px; letter-spacing:.2em; color:var(--dgray); text-transform:uppercase; margin:10px 0 5px; display:flex; align-items:center; gap:4px; }
  .perk-card { border:1px solid var(--dgray); padding:8px 10px; margin-bottom:5px; cursor:pointer; transition:all .1s; }
  .perk-card:hover:not(.locked) { border-color:var(--lgreen); background:#001100; }
  .perk-card.locked { opacity:.3; cursor:not-allowed; }
  .perk-card.owned { border-color:var(--green); background:#001100; opacity:.7; cursor:default; }
  .perk-name { font-size:13px; letter-spacing:.08em; margin-bottom:3px; }
  .perk-desc { font-size:13px; color:var(--lgray); line-height:1.9; }
  .perk-tier { font-size:11px; padding:1px 5px; display:inline-block; margin-top:4px; letter-spacing:.12em; border:1px solid; }
  .skill-tree-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  @media(max-width:560px){ .skill-tree-grid{grid-template-columns:1fr} }
  .skill-path-col { border:1px solid var(--dgray); padding:8px; }
  .skill-path-header { font-size:12px; letter-spacing:.18em; color:var(--dgray); text-transform:uppercase; margin-bottom:8px; text-align:center; }
  .perk-point-badge { display:inline-flex; align-items:center; gap:4px; font-size:13px; padding:3px 8px; border:1px solid var(--yellow); color:var(--yellow); cursor:pointer; }
  .perk-point-badge:hover { background:var(--yellow); color:var(--black); }

  /* ── LEADERBOARD ── */
  .lb-row { display:grid; grid-template-columns:26px 1fr 60px 44px 44px 50px; gap:6px; align-items:center; padding:5px 8px; border-bottom:1px solid var(--dgray); font-size:13px; }
  .lb-row:last-child { border-bottom:none; }
  .lb-row.you    { background:#001a00; border-left:2px solid var(--lgreen); }
  .lb-row.gold   { background:#1a1a00; border-left:2px solid var(--yellow); }
  .lb-row.silver { background:#111111; border-left:2px solid var(--lgray); }
  .lb-row.bronze { background:#110a00; border-left:2px solid var(--brown); }
  .lb-rank { font-size:12px; color:var(--dgray); text-align:center; }
  .lb-name { font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .lb-val  { text-align:right; color:var(--dgray); }
  .lb-header { display:grid; grid-template-columns:26px 1fr 60px 44px 44px 50px; gap:6px; padding:6px 8px; font-size:13px; letter-spacing:.18em; color:var(--dgray); text-transform:uppercase; border-bottom:1px solid var(--green); }
  .season-badge { display:inline-flex; align-items:center; gap:4px; font-size:12px; padding:2px 8px; border:1px solid var(--lcyan); color:var(--lcyan); }
  .hall-entry { border:1px solid var(--dgray); padding:10px; margin-bottom:6px; }
  .hall-season { font-size:12px; color:var(--yellow); letter-spacing:.18em; margin-bottom:6px; }
  .hall-winner { display:flex; align-items:center; gap:8px; padding:3px 0; font-size:13px; }
  .medal { font-size:13px; width:18px; text-align:center; }

  /* ── INVENTORY ── */
  .inv-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
  @media(max-width:480px){ .inv-grid{grid-template-columns:repeat(2,1fr)} }
  .inv-slot { border:1px solid var(--dgray); padding:8px 6px; text-align:center; position:relative; min-height:76px; display:flex; flex-direction:column; align-items:center; justify-content:center; transition:border-color .1s; }
  .inv-slot:hover:not(.empty) { border-color:var(--lgreen); }
  .inv-slot.empty { opacity:.25; }
  .inv-slot.uncommon { border-color:var(--lcyan);    }
  .inv-slot.rare     { border-color:var(--lmagenta); }
  .inv-icon  { font-size:20px; margin-bottom:3px; }
  .inv-name  { font-size:11px; color:var(--dgray); line-height:1.3; text-align:center; }
  .inv-qty   { position:absolute; top:3px; right:5px; font-size:12px; color:var(--lgreen); }
  .inv-tooltip { font-size:12px; color:var(--dgray); line-height:1.4; margin-top:3px; display:none; }
  .inv-slot:hover .inv-tooltip { display:block; }
  .inv-actions { display:flex; gap:4px; margin-top:4px; }
  .rarity-common   { color:var(--dgray); }
  .rarity-uncommon { color:var(--lcyan); }
  .rarity-rare     { color:var(--lmagenta); }

  /* ── QUESTS ── */
  .quest-card { border:1px solid var(--dgray); padding:8px 10px; margin-bottom:6px; transition:border-color .1s; }
  .quest-card.complete  { border-color:var(--lgreen); }
  .quest-card.claimed   { border-color:var(--dgray); opacity:.5; }
  .quest-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:4px; }
  .quest-label  { font-size:14px; letter-spacing:.06em; }
  .quest-diff   { font-size:11px; padding:1px 6px; border:1px solid; letter-spacing:.12em; }
  .quest-desc   { font-size:13px; color:var(--dgray); margin-bottom:6px; }
  .quest-prog-track { height:8px; background:var(--black); border:1px solid var(--dgray); overflow:hidden; margin-bottom:4px; }
  .quest-prog-fill  { height:100%; background:var(--green); transition:width .3s; }
  .quest-prog-fill.done { background:var(--lgreen); }
  .quest-prog-text  { font-size:12px; color:var(--dgray); }
  .quest-reward { font-size:12px; color:var(--yellow); margin-top:3px; }
  .quest-timer  { font-size:12px; color:var(--dgray); text-align:right; margin-top:4px; }

  /* ── FACTIONS ── */
  .faction-card { border:1px solid var(--dgray); padding:12px; margin-bottom:8px; cursor:pointer; transition:all .1s; }
  .faction-card:hover:not(.locked) { background:#0a0a0a; }
  .faction-card.selected { border-width:2px; }
  .faction-card.locked { opacity:.4; cursor:not-allowed; }
  .faction-icon { font-size:20px; margin-right:8px; }
  .faction-name { font-size:15px; letter-spacing:.1em; font-weight:700; }
  .faction-tagline { font-size:13px; color:var(--dgray); margin:3px 0 6px; font-style:italic; }
  .faction-bonus { font-size:13px; color:var(--dgray); margin:2px 0; }
  .faction-bonus::before { content:"+ "; color:var(--lgreen); }
  .faction-bar-track { height:10px; background:var(--black); border:1px solid var(--dgray); overflow:hidden; margin-top:6px; display:flex; }
  .faction-bar-seg { height:100%; transition:width .4s; }
  .faction-standings { border:1px solid var(--dgray); padding:8px 10px; margin-bottom:10px; }
  .faction-stand-row { display:flex; align-items:center; gap:8px; padding:4px 0; font-size:14px; border-bottom:1px solid #111; }
  .faction-stand-row:last-child { border-bottom:none; }
  .faction-rank-badge { font-size:11px; padding:1px 6px; border:1px solid; letter-spacing:.12em; }
  .faction-xp-bar { height:6px; background:var(--black); border:1px solid var(--dgray); overflow:hidden; margin-top:4px; }
  .faction-xp-fill { height:100%; transition:width .3s; }
  .faction-winner-banner { border:1px solid; padding:8px 12px; margin-bottom:10px; font-size:14px; }
  .faction-history-row { font-size:13px; color:var(--dgray); padding:3px 0; border-bottom:1px solid #111; }
  .faction-history-row:last-child { border-bottom:none; }

  /* ── STREAK ── */
  .streak-modal { position:fixed; inset:0; background:rgba(0,0,0,.88); z-index:500; display:flex; align-items:center; justify-content:center; padding:16px; }
  .streak-inner { background:var(--black); border:2px solid var(--yellow); max-width:480px; width:100%; padding:20px; text-align:center; }
  .streak-fire  { font-size:48px; margin-bottom:8px; animation:pulse 1s infinite; }
  @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.1)} }
  .streak-number { font-size:60px; color:var(--yellow); font-family:'IBM Plex Mono',monospace; line-height:1; margin-bottom:4px; }
  .streak-label  { font-size:13px; color:var(--dgray); letter-spacing:.25em; text-transform:uppercase; margin-bottom:16px; }
  .streak-calendar { display:flex; gap:4px; justify-content:center; margin:12px 0; flex-wrap:wrap; }
  .streak-day { width:28px; height:28px; border:1px solid var(--dgray); display:flex; align-items:center; justify-content:center; font-size:11px; color:var(--dgray); }
  .streak-day.active { border-color:var(--yellow); background:rgba(255,255,85,.12); color:var(--yellow); }
  .streak-day.today  { border-color:var(--lgreen); background:rgba(85,255,85,.15); color:var(--lgreen); }
  .streak-milestone { border:1px solid var(--yellow); padding:10px 16px; margin:12px 0; color:var(--yellow); font-size:13px; }
  .streak-milestone-label { font-size:11px; letter-spacing:.2em; color:var(--brown); margin-bottom:4px; }
  .streak-broken { border-color:var(--lred); color:var(--lred); }
  .streak-broken .streak-fire { filter:grayscale(1); }
  .streak-next { font-size:14px; color:var(--dgray); margin-top:8px; }
  .streak-next span { color:var(--yellow); }
  .streak-badge { display:inline-block; font-size:11px; padding:1px 8px; border:1px solid var(--yellow); color:var(--yellow); letter-spacing:.15em; margin:4px; }
  /* Streak indicator in hub */
  .streak-chip { display:inline-flex; align-items:center; gap:4px; font-size:13px; padding:2px 8px; border:1px solid var(--yellow); color:var(--yellow); cursor:pointer; }
  .streak-chip:hover { background:rgba(255,255,85,.1); }

  /* ── LORD-STYLE MENU ── */
  .lord-menu { display:flex; flex-direction:column; gap:0; }
  .lord-item { display:grid; grid-template-columns:44px 1fr auto; align-items:center; gap:12px; padding:13px 10px; background:transparent; border:none; border-bottom:1px solid #252525; color:var(--lgray); cursor:pointer; text-align:left; font-family:'IBM Plex Mono',monospace; transition:background .1s; width:100%; }
  .lord-item:hover { background:#181818; }
  .lord-item:last-child { border-bottom:none; }
  .lord-key  { font-size:15px; color:var(--lgreen); font-weight:700; text-align:center; background:#0a1a0a; padding:3px 0; border:1px solid #1a3a1a; }
  .lord-name { font-size:15px; color:var(--white); letter-spacing:.04em; }
  .lord-hint { font-size:13px; color:var(--dgray); text-align:right; max-width:160px; line-height:1.4; }
  /* Back button */
  .lord-back { display:inline-flex; align-items:center; gap:8px; font-family:'IBM Plex Mono',monospace; font-size:14px; padding:7px 14px; background:var(--bg2); border:1px solid #444; color:var(--lgray); cursor:pointer; margin-bottom:14px; letter-spacing:.08em; }
  .lord-back:hover { border-color:var(--lgreen); color:var(--lgreen); }
  /* Location header */
  .location-header { font-size:13px; letter-spacing:.2em; color:var(--lgray); text-transform:uppercase; margin-bottom:12px; padding-bottom:6px; border-bottom:1px solid #2a2a2a; }
  /* Status bar improvements */
  .status-bar { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:start; }
  .status-name { font-size:16px; letter-spacing:.06em; }
  .status-right { text-align:right; }
  .status-credits { font-size:16px; color:var(--yellow); }
  .status-turns { font-size:14px; color:var(--dgray); margin-top:2px; }
  .status-turns.low { color:var(--lred); animation:blink .8s infinite; }
  /* HP bar warning */
  .bar-hp.critical { background:var(--lred) !important; }
  /* Alert dot on menu items */
  .lord-alert { display:inline-block; width:7px; height:7px; background:var(--lgreen); border-radius:50%; margin-left:6px; animation:pulse 1.5s infinite; vertical-align:middle; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  /* Combat improvements */
  .combat-action-hint { font-size:11px; color:var(--dgray); text-align:center; margin-top:6px; letter-spacing:.12em; }
  /* Create screen */
  .class-grid { display:flex; flex-direction:column; gap:8px; }
  .class-row { display:grid; grid-template-columns:70px 1fr; gap:14px; border:1px solid #333; padding:12px; cursor:pointer; transition:border-color .1s; align-items:start; }
  .class-row:hover, .class-row.selected { border-color:var(--lgreen); background:#070f07; }
  .class-row-icon { font-size:13px; font-weight:700; text-align:center; }
  .class-row-stats { font-size:13px; color:var(--dgray); margin-top:4px; white-space:nowrap; }
  .class-row-ability { font-size:13px; color:var(--lgray); margin-top:6px; border-top:1px solid #2a2a2a; padding-top:6px; }

  /* ── PLAYER PROFILE MODAL ── */
  .profile-modal { position:fixed; inset:0; background:rgba(0,0,0,.88); z-index:600; display:flex; align-items:center; justify-content:center; padding:16px; }
  .profile-inner { background:var(--black); border:1px solid var(--lgreen); max-width:520px; width:100%; max-height:90vh; overflow-y:auto; }
  .profile-header { padding:12px 14px; border-bottom:1px solid #1a1a1a; }
  .profile-name { font-size:17px; letter-spacing:.08em; margin-bottom:4px; }
  .profile-sub { font-size:13px; color:var(--dgray); }
  .profile-stats { display:grid; grid-template-columns:1fr 1fr; gap:0; border-bottom:1px solid #1a1a1a; }
  .profile-stat { padding:8px 14px; border-right:1px solid #1a1a1a; border-bottom:1px solid #1a1a1a; }
  .profile-stat:nth-child(2n) { border-right:none; }
  .profile-stat-label { font-size:11px; letter-spacing:.2em; color:var(--dgray); text-transform:uppercase; }
  .profile-stat-val { font-size:14px; color:var(--lgreen); margin-top:3px; }
  .profile-titles { padding:8px 14px; border-bottom:1px solid #1a1a1a; display:flex; flex-wrap:wrap; gap:4px; }
  .profile-lyra { padding:10px 14px; border-bottom:1px solid #1a1a1a; font-size:14px; color:var(--lmagenta); font-style:italic; line-height:1.8; }
  .profile-lyra-label { font-size:11px; letter-spacing:.2em; color:var(--dgray); font-style:normal; margin-bottom:4px; }
  .profile-msgs { padding:10px 14px; border-bottom:1px solid #1a1a1a; }
  .profile-msg { font-size:13px; padding:5px 0; border-bottom:1px solid #111; color:var(--dgray); line-height:1.9; }
  .profile-msg:last-child { border-bottom:none; }
  .profile-msg-from { color:var(--lgray); margin-right:6px; }
  .profile-actions { padding:10px 14px; display:flex; flex-direction:column; gap:8px; }
  .profile-msg-row { display:flex; gap:6px; }
  .clickable-name { cursor:pointer; text-decoration:underline; text-decoration-style:dotted; text-underline-offset:2px; }
  .clickable-name:hover { opacity:.8; }

  /* ── GRID RATING & SPONSORS ── */
  .rating-bar-track { height:8px; background:#111; border:1px solid #333; overflow:hidden; margin-top:3px; }
  .rating-bar-fill  { height:100%; transition:width .4s; }
  .rating-row { display:flex; align-items:center; gap:8px; margin-bottom:6px; font-size:13px; }
  .rating-label { width:110px; color:var(--lgray); letter-spacing:.06em; flex-shrink:0; }
  .rating-val { width:38px; text-align:right; flex-shrink:0; font-size:14px; }
  .sponsor-card { border:1px solid; padding:10px 14px; margin-bottom:10px; }
  .sponsor-name { font-size:14px; letter-spacing:.1em; font-weight:700; margin-bottom:3px; }
  .sponsor-tagline { font-size:12px; color:var(--dgray); font-style:italic; margin-bottom:6px; }
  .sponsor-perk { font-size:13px; color:var(--dgray); margin:2px 0; }
  .sponsor-perk::before { content:"+ "; color:var(--lgreen); }
  .rep-title { display:inline-block; font-size:13px; padding:2px 10px; border:1px solid; letter-spacing:.15em; margin-left:8px; }
  /* Transmission / intervention modal */
  .transmission-modal { position:fixed; inset:0; background:rgba(0,0,0,.9); z-index:900; display:flex; align-items:center; justify-content:center; padding:16px; }
  .transmission-inner { background:var(--black); max-width:460px; width:100%; }
  .transmission-header { padding:8px 14px; border-bottom:1px solid; font-size:12px; letter-spacing:.2em; }
  .transmission-body { padding:14px; font-size:14px; line-height:2; }
  .transmission-footer { padding:8px 14px; border-top:1px solid #1a1a1a; text-align:center; font-size:12px; color:var(--dgray); letter-spacing:.15em; animation:blink .9s infinite; cursor:pointer; }

  /* ── THE GHOST COLLECTIVE ── */
  .collective-badge { display:inline-block; font-size:13px; color:#aaaaaa; margin-left:6px; letter-spacing:.1em; }
  .collective-badge.visible { color:#ffffff; text-shadow:0 0 8px rgba(255,255,255,.6); }
  .collective-portal { border:1px solid #333; padding:12px 14px; margin-bottom:10px; position:relative; overflow:hidden; }
  .collective-portal::before { content:''; position:absolute; inset:0; background:repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,255,255,.01) 10px,rgba(255,255,255,.01) 11px); pointer-events:none; }
  .collective-clue { font-size:13px; color:#555555; font-style:italic; line-height:1.8; font-family:'IBM Plex Mono',monospace; }
  .collective-induction { border:1px solid #ffffff; padding:12px 14px; background:#050505; }
  .collective-induction-title { font-size:12px; letter-spacing:.25em; color:#aaaaaa; margin-bottom:8px; }
  .collective-induction-body { font-size:14px; color:#ffffff; line-height:1.8; }
  .collective-chat-feed { max-height:180px; overflow-y:auto; margin-bottom:8px; border:1px solid #1a1a1a; padding:6px 8px; }
  .collective-msg { font-size:13px; padding:3px 0; border-bottom:1px solid #0a0a0a; color:#aaaaaa; line-height:1.8; }
  .collective-msg:last-child { border-bottom:none; }
  .collective-symbol { font-size:16px; text-align:center; color:#333333; letter-spacing:.3em; margin:8px 0; }

  /* ── HELP SYSTEM ── */
  .help-modal { position:fixed; inset:0; background:rgba(0,0,0,.92); z-index:850; display:flex; align-items:center; justify-content:center; padding:16px; }
  .help-inner { background:var(--black); border:1px solid #555555; max-width:500px; width:100%; max-height:90vh; overflow-y:auto; }
  .help-header { padding:8px 14px; border-bottom:1px solid #1a1a1a; display:flex; justify-content:space-between; align-items:center; }
  .help-title { font-size:13px; letter-spacing:.2em; color:var(--lgray); }
  .help-body { padding:14px; }
  .help-section { margin-bottom:14px; }
  .help-section-title { font-size:12px; letter-spacing:.2em; color:var(--lcyan); margin-bottom:6px; border-bottom:1px solid #111; padding-bottom:4px; }
  .help-line { font-size:14px; color:var(--lgray); line-height:1.9; }
  .help-line .hl { color:var(--lgreen); }
  .help-line .hl-y { color:var(--yellow); }
  .help-line .hl-r { color:var(--lred); }
  .help-line .hl-c { color:var(--lcyan); }
  .help-line .hl-m { color:#ff55ff; }
  .help-key { display:inline-block; background:#0a0a0a; border:1px solid #333; padding:0 5px; font-size:12px; color:var(--lgreen); margin:0 2px; font-family:'IBM Plex Mono',monospace; }
  .help-footer { padding:8px 14px; border-top:1px solid #1a1a1a; text-align:center; font-size:12px; color:var(--dgray); letter-spacing:.15em; cursor:pointer; }

  /* ── ONBOARDING ── */
  .onboard-modal { position:fixed; inset:0; background:rgba(0,0,0,.94); z-index:800; display:flex; align-items:center; justify-content:center; padding:16px; }
  .onboard-inner { background:var(--black); border:1px solid var(--lcyan); max-width:480px; width:100%; font-family:'IBM Plex Mono',monospace; }
  .onboard-header { background:#001a1a; padding:10px 16px; border-bottom:1px solid var(--lcyan); font-size:13px; letter-spacing:.2em; color:var(--lcyan); }
  .onboard-body { padding:16px; }
  .onboard-line { font-size:14px; line-height:2; color:var(--lgray); }
  .onboard-line.highlight { color:var(--lgreen); }
  .onboard-line.warn { color:var(--yellow); }
  .onboard-line.dim { color:var(--dgray); }
  .onboard-line.sig { color:var(--lcyan); margin-top:8px; }
  .onboard-footer { padding:10px 16px; border-top:1px solid #1a1a1a; text-align:center; font-size:13px; color:var(--dgray); letter-spacing:.15em; animation:blink .9s infinite; }

  /* ── OFFLINE ATTACK LOG ── */
  .attack-log-modal { position:fixed; inset:0; background:rgba(0,0,0,.92); z-index:700; display:flex; align-items:center; justify-content:center; padding:16px; }
  .attack-log-inner { background:var(--black); border:2px solid var(--lred); max-width:500px; width:100%; }
  .attack-log-header { background:#1a0000; padding:10px 14px; border-bottom:1px solid var(--lred); }
  .attack-log-title { font-size:13px; color:var(--lred); letter-spacing:.12em; }
  .attack-log-sub { font-size:12px; color:var(--dgray); margin-top:3px; }
  .attack-log-entry { padding:10px 14px; border-bottom:1px solid #1a0000; display:flex; align-items:flex-start; gap:10px; }
  .attack-log-entry:last-of-type { border-bottom:none; }
  .attack-log-icon { font-size:16px; flex-shrink:0; margin-top:1px; }
  .attack-log-text { flex:1; font-size:14px; line-height:1.8; }
  .attack-log-attacker { font-weight:700; }
  .attack-log-age { font-size:12px; color:var(--dgray); margin-top:2px; }
  .attack-log-summary { padding:10px 14px; border-top:1px solid #1a0000; background:#0a0000; font-size:14px; }
  .attack-log-actions { padding:10px 14px; display:flex; gap:8px; }
  .dungeon-card { border:1px solid var(--dgray); padding:12px; margin-bottom:8px; transition:border-color .1s; cursor:pointer; }
  .dungeon-card:hover:not(.locked) { background:#0a0a0a; }
  .dungeon-card.locked { opacity:.35; cursor:not-allowed; }
  .dungeon-card.cleared { border-style:dashed; }
  .dungeon-name { font-size:15px; letter-spacing:.1em; margin-bottom:4px; }
  .dungeon-desc { font-size:13px; color:var(--dgray); margin-bottom:8px; line-height:1.9; }
  .dungeon-rooms { display:flex; gap:4px; margin-bottom:8px; }
  .dungeon-room-pip { width:16px; height:16px; border:1px solid var(--dgray); font-size:8px; display:flex; align-items:center; justify-content:center; }
  .dungeon-room-pip.cleared { background:var(--green); border-color:var(--green); }
  .dungeon-room-pip.current { border-color:var(--lgreen); animation:blink .7s infinite; }
  .dungeon-room-pip.boss { border-color:var(--lred); color:var(--lred); }
  .dungeon-screen { }
  .dungeon-header { border:1px solid; padding:10px 14px; margin-bottom:10px; }
  .dungeon-room-title { font-size:14px; letter-spacing:.1em; margin-bottom:4px; }
  .dungeon-progress { display:flex; gap:6px; align-items:center; margin-top:8px; }
  .dungeon-pip { width:20px; height:20px; border:1px solid var(--dgray); font-size:11px; display:flex; align-items:center; justify-content:center; transition:all .2s; }
  .dungeon-pip.done    { background:var(--green);  border-color:var(--green);  color:#000; }
  .dungeon-pip.active  { border-color:var(--lgreen); color:var(--lgreen); animation:blink .7s infinite; }
  .dungeon-pip.boss    { border-color:var(--lred); color:var(--lred); }
  .dungeon-loot-list { font-size:13px; color:var(--dgray); margin:6px 0; line-height:1.8; }
  .dungeon-loot-list .loot-credit { color:var(--yellow); }
  .dungeon-loot-list .loot-xp     { color:var(--lcyan);  }
  .dungeon-loot-list .loot-item   { color:var(--lmagenta); }
  .dungeon-log { max-height:110px; overflow-y:auto; font-size:13px; color:var(--dgray); line-height:1.9; border:1px solid var(--dgray); padding:4px 8px; margin-bottom:10px; }
  .dungeon-log .room-clear { color:var(--lgreen); }
  .dungeon-log .room-boss  { color:var(--lred); }
  .dungeon-log .room-loot  { color:var(--yellow); }
  .dungeon-log .room-dmg   { color:var(--lred); }
  .dungeon-complete { border:2px solid; padding:16px; text-align:center; margin-bottom:12px; }
  .dungeon-complete-title { font-size:18px; letter-spacing:.15em; margin-bottom:8px; }
  .dungeon-title-badge { display:inline-block; font-size:13px; padding:3px 12px; border:1px solid; letter-spacing:.15em; margin-top:8px; }

  /* ── EVENT SCREEN ── */
  .event-card { border:1px solid; padding:14px; margin-bottom:12px; }
  .event-type { font-size:11px; letter-spacing:.28em; text-transform:uppercase; color:var(--dgray); margin-bottom:5px; }
  .event-icon { font-size:28px; margin-bottom:8px; display:block; }
  .event-label { font-size:13px; letter-spacing:.1em; margin-bottom:8px; }
  .event-choices { display:flex; flex-direction:column; gap:6px; margin-top:12px; }
  .event-result { border:1px solid; padding:10px 12px; margin-top:10px; }
  .event-result-label { font-size:11px; letter-spacing:.22em; color:var(--dgray); margin-bottom:3px; }
  .event-tag-windfall { border-color:var(--lgreen); color:var(--lgreen); }
  .event-tag-trap     { border-color:var(--lred);   color:var(--lred);   }
  .event-tag-choice   { border-color:var(--lcyan);  color:var(--lcyan);  }

  /* ── CHAT ── */
  .chat-feed { max-height:280px; overflow-y:auto; border:1px solid var(--dgray); padding:6px 10px; background:var(--black); margin-bottom:8px; display:flex; flex-direction:column-reverse; gap:1px; }
  .chat-msg { font-size:14px; line-height:1.8; word-break:break-word; }
  .chat-msg.system { color:var(--lcyan); font-style:italic; }
  .chat-msg.event  { color:var(--yellow); }
  .chat-msg .chat-meta { font-size:12px; color:var(--dgray); margin-right:4px; }
  .chat-msg .chat-handle { font-size:13px; margin-right:4px; }
  .chat-msg .chat-text { color:var(--lgreen); }
  .chat-msg.you .chat-text { color:var(--white); }
  .chat-input-row { display:flex; gap:6px; align-items:flex-end; }
  .chat-input { font-family:'IBM Plex Mono',monospace; font-size:14px; padding:5px 8px; background:var(--black); border:1px solid var(--green); color:var(--lgreen); outline:none; flex:1; resize:none; min-height:32px; max-height:70px; line-height:1.4; }
  .chat-input:focus { border-color:var(--lgreen); }
  .chat-input::placeholder { color:var(--dgray); }
  .chat-chars { font-size:12px; color:var(--dgray); text-align:right; margin-bottom:3px; }
  .chat-cooldown { font-size:13px; color:var(--dgray); text-align:center; padding:4px; }

  /* ── MISC ── */
  .credits { color:var(--yellow); }
  .green   { color:var(--lgreen); }
  .dim     { color:var(--dgray); font-size:13px; }
  .flex    { display:flex; align-items:center; gap:8px; }
  .flex-between { display:flex; align-items:center; justify-content:space-between; }
  .mt-8{margin-top:8px} .mt-12{margin-top:12px} .mb-8{margin-bottom:8px} .mb-12{margin-bottom:12px}
  .badge { display:inline-block; font-size:12px; padding:1px 6px; letter-spacing:.12em; }
  .badge-green { border:1px solid var(--green); color:var(--lgreen); }
  .separator { border:none; border-top:1px solid var(--dgray); margin:8px 0; }

  .glitch { animation:glitch .3s; }
  @keyframes glitch {
    0%{transform:translate(0)} 20%{transform:translate(-2px,1px);filter:hue-rotate(90deg)}
    40%{transform:translate(2px,-1px)} 60%{transform:translate(-1px,2px);filter:hue-rotate(-90deg)}
    80%{transform:translate(1px,-1px)} 100%{transform:translate(0)}
  }
  @keyframes lootpop { 0%{transform:scale(1)} 40%{transform:scale(1.12)} 100%{transform:scale(1)} }

  /* BBS-style horizontal rule */
  .bbs-hr { color:var(--dgray); white-space:pre; font-size:13px; line-height:1; display:block; margin:6px 0; overflow:hidden; }
  /* Menu-style option highlight */
  .menu-key { color:var(--white); background:var(--dgray); padding:0 3px; margin-right:4px; }

  /* Title screen */
  .title-screen { text-align:center; padding:20px 0; }
  .title-prompt { color:var(--lgray); font-size:14px; letter-spacing:.15em; animation:blink .8s infinite; }

  /* ── KILL SCREEN ── */
  .kill-screen { text-align:center; padding:20px 0; }
  .kill-screen-title { font-size:28px; color:#ff5555; font-weight:700; letter-spacing:.2em; margin-bottom:4px; text-shadow:0 0 20px #ff555588; }
  .kill-screen-enemy { font-size:16px; color:#888; letter-spacing:.15em; margin-bottom:20px; }
  .kill-screen-stats { display:grid; grid-template-columns:1fr 1fr; gap:8px; max-width:360px; margin:0 auto 20px; }
  .kill-stat { background:#111; border:1px solid #222; padding:10px; }
  .kill-stat-label { font-size:10px; color:#555; letter-spacing:.2em; margin-bottom:4px; }
  .kill-stat-value { font-size:20px; color:#55ff55; font-weight:700; }
  .kill-stat-value.red { color:#ff5555; }
  .kill-stat-value.yellow { color:#ffff55; }
  .kill-screen-narration { max-width:500px; margin:0 auto 20px; color:#55ff55; font-size:13px; line-height:1.8; text-align:left; padding:12px; border:1px solid #1a1a1a; background:#050505; }
  .kill-screen-narration::before { content:"> "; color:#555; }

  /* ── ACHIEVEMENTS ── */
  .achievement-toast { position:fixed; bottom:24px; right:24px; z-index:950; max-width:320px; background:#0a0a0a; border:1px solid #ffff55; animation:achieveIn .4s ease; cursor:pointer; }
  @keyframes achieveIn { from { transform:translateX(120%); opacity:0; } to { transform:translateX(0); opacity:1; } }
  .achievement-header { background:#111100; padding:6px 12px; border-bottom:1px solid #333300; font-size:10px; letter-spacing:.2em; color:#ffff55; }
  .achievement-body { padding:10px 12px; display:flex; gap:10px; align-items:flex-start; }
  .achievement-icon { font-size:24px; flex-shrink:0; }
  .achievement-name { font-size:13px; color:#ffffff; font-weight:700; margin-bottom:3px; }
  .achievement-desc { font-size:11px; color:#888; line-height:1.6; }
  .achievement-dismiss { padding:4px 12px; border-top:1px solid #222200; text-align:right; font-size:10px; color:#555; }

  /* ── AUTH SCREENS ── */
  .auth-box { max-width:420px; margin:0 auto; }
  .auth-title { font-size:14px; letter-spacing:.2em; color:var(--lcyan); margin-bottom:6px; }
  .auth-sub { font-size:13px; color:var(--dgray); margin-bottom:16px; line-height:1.7; }
  .auth-error { font-size:13px; color:var(--lred); margin-bottom:10px; padding:8px 12px; border:1px solid var(--lred); background:#1a0000; }
  .auth-switch { font-size:13px; color:var(--dgray); margin-top:14px; text-align:center; }
  .auth-switch span { color:var(--lcyan); cursor:pointer; text-decoration:underline; text-underline-offset:2px; }
  .auth-switch span:hover { color:var(--lgreen); }

  /* Scrollbars */
  ::-webkit-scrollbar { width:6px; height:6px; }
  ::-webkit-scrollbar-track { background:var(--black); }
  ::-webkit-scrollbar-thumb { background:var(--green); }
`;

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function StatBar({ label, value, max, type }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <div className="bar-track"><div className={`bar-fill bar-${type}`} style={{ width: `${pct}%` }} /></div>
      <span className="stat-val">{value}/{max}</span>
    </div>
  );
}

function Narration({ text, loading }) {
  return (
    <div className={`narration ${loading ? "loading" : ""}`}>
      {loading
        ? <><span style={{ color: "#555555" }}>processing...</span><span className="cursor" /></>
        : <>{text}{text && <span className="cursor" />}</>}
    </div>
  );
}

function StatusChips({ statuses, buff }) {
  return (
    <div className="status-chips">
      {(statuses || []).map((s, i) => {
        const d = STATUS_DEFS[s.type] || { label: s.type.toUpperCase(), color: "#fff" };
        return <span key={i} className="status-chip" style={{ color: d.color, borderColor: d.color, background: `${d.color}15` }}>{d.label} ×{s.turns}</span>;
      })}
      {buff && <span className="buff-chip">+{buff.stat.toUpperCase()} BUFF</span>}
    </div>
  );
}

function NpcBubble({ who, text, loading }) {
  const color = who === "lyra" ? "#ff55ff" : "#55ffff";
  const label = who === "lyra" ? "LYRA" : "STATIC";
  return (
    <div className={`bubble ${who}`}>
      <div className="bubble-speaker">{label} //</div>
      {loading
        ? <span style={{ color: "#555555" }}>...<span className="cursor" style={{ background: color }} /></span>
        : <span>{text}</span>}
    </div>
  );
}

// ─── ANSI SYSTEM ─────────────────────────────────────────────────────────────

// ─── CP437 → UNICODE MAP ──────────────────────────────────────────────────────
// Maps IBM Code Page 437 byte values to Unicode characters
const CP437 = [
  '\u0000','☺','☻','♥','♦','♣','♠','•','◘','○','◙','♂','♀','♪','♫','☼',
  '►','◄','↕','‼','¶','§','▬','↨','↑','↓','→','←','∟','↔','▲','▼',
  ' ','!','"','#','$','%','&',"'",'(',')','*','+',',','-','.','/',
  '0','1','2','3','4','5','6','7','8','9',':',';','<','=','>','?',
  '@','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O',
  'P','Q','R','S','T','U','V','W','X','Y','Z','[','\\',']','^','_',
  '`','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o',
  'p','q','r','s','t','u','v','w','x','y','z','{','|','}','~','⌂',
  'Ç','ü','é','â','ä','à','å','ç','ê','ë','è','ï','î','ì','Ä','Å',
  'É','æ','Æ','ô','ö','ò','û','ù','ÿ','Ö','Ü','¢','£','¥','₧','ƒ',
  'á','í','ó','ú','ñ','Ñ','ª','º','¿','⌐','¬','½','¼','¡','«','»',
  '░','▒','▓','│','┤','╡','╢','╖','╕','╣','║','╗','╝','╜','╛','┐',
  '└','┴','┬','├','─','┼','╞','╟','╚','╔','╩','╦','╠','═','╬','╧',
  '╨','╤','╥','╙','╘','╒','╓','╫','╪','┘','┌','█','▄','▌','▐','▀',
  'α','ß','Γ','π','Σ','σ','µ','τ','Φ','Θ','Ω','δ','∞','φ','ε','∩',
  '≡','±','≥','≤','⌠','⌡','÷','≈','°','∙','·','√','ⁿ','²','■','\u00a0'
];

// ─── CGA 16-COLOR PALETTE ────────────────────────────────────────────────────
const CGA = [
  '#000000', // 0  black
  '#0000aa', // 1  blue
  '#00aa00', // 2  green
  '#00aaaa', // 3  cyan
  '#aa0000', // 4  red
  '#aa00aa', // 5  magenta
  '#aa5500', // 6  brown
  '#aaaaaa', // 7  light gray
  '#555555', // 8  dark gray
  '#5555ff', // 9  bright blue
  '#55ff55', // 10 bright green
  '#55ffff', // 11 bright cyan
  '#ff5555', // 12 bright red
  '#ff55ff', // 13 bright magenta
  '#ffff55', // 14 yellow
  '#ffffff', // 15 white
];

// ─── ANSI PARSER ─────────────────────────────────────────────────────────────
function parseAnsi(raw) {
  // Returns array of cells: { char, fg, bg, bold, blink }
  // Grid is 80 wide, variable height
  const COLS = 80;
  const cells = [];
  let row = 0, col = 0;
  let fg = 7, bg = 0, bold = false, blink = false;

  const getIdx = (r, c) => r * COLS + c;
  const setCell = (r, c, ch) => {
    const idx = getIdx(r, c);
    while (cells.length <= idx) cells.push(null);
    cells[idx] = { char: ch, fg: bold ? Math.min(fg + 8, 15) : fg, bg, blink };
  };

  let i = 0;
  while (i < raw.length) {
    const byte = typeof raw[i] === 'number' ? raw[i] : raw.charCodeAt(i);

    // ESC sequence
    if (byte === 0x1b && (typeof raw[i+1] === 'number' ? raw[i+1] : raw.charCodeAt(i+1)) === 0x5b) {
      i += 2; // skip ESC [
      let seq = '';
      while (i < raw.length) {
        const cb = typeof raw[i] === 'number' ? raw[i] : raw.charCodeAt(i);
        if (cb >= 0x40 && cb <= 0x7e) { // command byte
          const cmd = String.fromCharCode(cb);
          i++;
          if (cmd === 'm') {
            // SGR — color/attr
            const parts = seq ? seq.split(';').map(Number) : [0];
            for (const p of parts) {
              if (p === 0) { fg = 7; bg = 0; bold = false; blink = false; }
              else if (p === 1) bold = true;
              else if (p === 5) blink = true;
              else if (p >= 30 && p <= 37) fg = p - 30;
              else if (p === 39) fg = 7;
              else if (p >= 40 && p <= 47) bg = p - 40;
              else if (p === 49) bg = 0;
              // High-intensity via 90-97 / 100-107
              else if (p >= 90 && p <= 97) fg = p - 90 + 8;
              else if (p >= 100 && p <= 107) bg = p - 100 + 8;
            }
          } else if (cmd === 'H' || cmd === 'f') {
            // Cursor position
            const parts = seq ? seq.split(';').map(Number) : [1, 1];
            row = Math.max(0, (parts[0] || 1) - 1);
            col = Math.max(0, (parts[1] || 1) - 1);
          } else if (cmd === 'A') { row = Math.max(0, row - (parseInt(seq)||1)); }
          else if (cmd === 'B') { row += parseInt(seq)||1; }
          else if (cmd === 'C') { col = Math.min(COLS-1, col + (parseInt(seq)||1)); }
          else if (cmd === 'D') { col = Math.max(0, col - (parseInt(seq)||1)); }
          else if (cmd === 'J') { /* clear screen — ignore for rendering */ }
          else if (cmd === 'K') { /* clear line — ignore */ }
          break;
        }
        seq += String.fromCharCode(cb);
        i++;
      }
      continue;
    }

    // Newline
    if (byte === 0x0d) { i++; continue; } // CR
    if (byte === 0x0a) { row++; col = 0; i++; continue; } // LF

    // Printable CP437 char
    const ch = CP437[byte] || ' ';
    setCell(row, col, ch);
    col++;
    if (col >= COLS) { col = 0; row++; }
    i++;
  }

  return { cells, rows: row + 1, cols: COLS };
}

// ─── ANSI RENDERER COMPONENT ──────────────────────────────────────────────────
function AnsiRenderer({ data, cellW = 8, cellH = 16 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
    const { cells, rows, cols } = data;
    const canvas = canvasRef.current;
    canvas.width  = cols * cellW;
    canvas.height = rows * cellH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${cellH}px "Perfect DOS VGA 437", "Courier New", monospace`;
    ctx.textBaseline = 'top';

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = cells[r * cols + c];
        if (!cell) continue;
        const x = c * cellW, y = r * cellH;
        // Background
        ctx.fillStyle = CGA[cell.bg] || '#000';
        ctx.fillRect(x, y, cellW, cellH);
        // Character
        if (cell.char && cell.char !== ' ') {
          ctx.fillStyle = CGA[cell.fg] || '#aaa';
          ctx.fillText(cell.char, x, y);
        }
      }
    }
  }, [data, cellW, cellH]);

  return <canvas ref={canvasRef} style={{ imageRendering: 'pixelated', display: 'block', maxWidth: '100%' }} />;
}

// ─── HAND-CRAFTED NETRUNNER ANSI ART ─────────────────────────────────────────
// Each piece is encoded as an array of rows, each row an array of {char, fg, bg}
// We'll render these directly as React spans for crisp web output

const CELL_W = 9;   // px per character cell
const CELL_H = 16;

// Helper to build a colored span
function Span({ fg, bg, children, blink }) {
  return (
    <span style={{
      color: CGA[fg],
      backgroundColor: CGA[bg],
      display: 'inline-block',
      width: CELL_W,
      height: CELL_H,
      lineHeight: `${CELL_H}px`,
      textAlign: 'center',
      animation: blink ? 'blink 1s step-end infinite' : 'none',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {children}
    </span>
  );
}

// Shorthand cell builder: c(char, fg, bg)
const c = (ch, fg=7, bg=0) => ({ ch, fg, bg });
const _ = c(' ', 7, 0); // black space

// ─── NETRUNNER LOGO ───────────────────────────────────────────────────────────
// Hand-crafted in the iCE/ACiD style: thick block letters, ░▒▓█ shading
// Colors: bright cyan (11) / cyan (3) / blue (1) on black, white highlights
// "NETRUNNER" — 9 chars × block font ~8 rows tall

const LOGO_ART = [
// Row 0 — tops of letters
"  ██████  ██████  ██████  ██████  ██  ██  ██  ██  ██████  ██████  ██████  ",
"  ██  ██  ██      ██        ██    ██  ██  ██  ██  ████    ██  ██  ██      ",
"  ██  ██  ████    ██████    ██    ██████  ██  ██  ██  ██  ██  ██  ████    ",
"  ██  ██  ██          ██    ██    ██  ██  ██  ██  ██  ██  ██  ██  ██      ",
"  ██████  ██████  ██████    ██    ██  ██  ██████  ██████  ██████  ██████  ",
].map(row => row.split('').map(ch => {
  if (ch === '█') return c('█', 11, 0);
  if (ch === '░') return c('░', 11, 0);
  if (ch === '▒') return c('▒', 3, 0);
  if (ch === '▓') return c('▓', 1, 0);
  return c(' ', 0, 0);
}));

// Full hand-crafted art pieces as raw ANSI-style data
// We define each piece as a function returning rows of cells

function makeLogoRows() {
  const W = 72;
  // Letter definitions for NETRUNNER using block chars
  // N E T R U N N E R
  const letters = {
    N: [
      [11,11,0,0,11,11],[11,11,11,0,11,11],[11,11,11,11,11,11],[11,11,0,11,11,11],[11,11,0,0,11,11]
    ],
    E: [
      [11,11,11,11],[11,11,0,0],[11,11,11,0],[11,11,0,0],[11,11,11,11]
    ],
    T: [
      [11,11,11,11,11],[0,0,11,0,0],[0,0,11,0,0],[0,0,11,0,0],[0,0,11,0,0]
    ],
    R: [
      [11,11,11,11],[11,0,0,11],[11,11,11,0],[11,0,11,0],[11,0,0,11]
    ],
    U: [
      [11,0,0,11],[11,0,0,11],[11,0,0,11],[11,0,0,11],[11,11,11,11]
    ],
  };
  return letters;
}

// ─── TITLE SCREEN ART ─────────────────────────────────────────────────────────
// Full title screen in authentic BBS style

const TITLE_ROWS = (() => {
  // Build the title art as an array of "rows", each row = array of {ch,fg,bg}
  const rows = [];
  const W = 78;
  const row = (arr) => { rows.push(arr); };
  const blank = () => row(Array(W).fill(c(' ',0,0)));
  const fill = (str, fg=7, bg=0) => {
    const cells = [];
    for (let i = 0; i < W; i++) {
      const ch = str[i] || ' ';
      cells.push(c(ch, fg, bg));
    }
    return cells;
  };
  const text = (str, fg=7, bg=0) => row(fill(str.padEnd(W), fg, bg));

  // Top border
  row(fill('╔' + '═'.repeat(W-2) + '╗', 11, 0));

  // Logo — NETRUNNER in block chars
  // Each letter is 6 wide × 5 tall, with 1-char gaps
  const LETTERS = {
    N: ['█▓  ▓█','██▓ ▓█','█▓█▓█','█▓ ██','█▓  █'],
    E: ['████','█▓  ','███ ','█▓  ','████'],
    T: ['█████','  █  ','  █  ','  █  ','  █  '],
    R: ['████','█  █','███ ','█ █ ','█  █'],
    U: ['█  █','█  █','█  █','█  █','████'],
  };

  const word = 'NETRUNNER';
  const logoHeight = 7;

  // Top logo padding
  row(fill('║' + ' '.repeat(W-2) + '║', 11, 0));

  // Render each row of the logo
  for (let lr = 0; lr < 5; lr++) {
    const cells = [c('║',11,0)];
    // Center the logo
    const padding = 3;
    for (let i = 0; i < padding; i++) cells.push(c(' ',0,0));

    for (let li = 0; li < word.length; li++) {
      const L = word[li];
      const def = LETTERS[L] || ['    ','    ','    ','    ','    '];
      const rowStr = (def[lr] || '    ').padEnd(def[0]?.length || 4);
      for (const ch of rowStr) {
        if (ch === '█') cells.push(c('█', lr===0?15:lr===1?11:lr===2?11:lr===3?3:1, 0));
        else if (ch === '▓') cells.push(c('▓', lr===0?11:lr===1?3:3, 0));
        else if (ch === '▒') cells.push(c('▒', 3, 0));
        else if (ch === '░') cells.push(c('░', 1, 0));
        else cells.push(c(' ', 0, 0));
      }
      cells.push(c(' ',0,0)); // letter gap
    }

    // Pad to W-1 then close border
    while (cells.length < W-1) cells.push(c(' ',0,0));
    cells.push(c('║',11,0));
    rows.push(cells.slice(0,W));
  }

  // Shadow row
  const shadowCells = [c('║',11,0)];
  for (let i = 1; i < W-1; i++) shadowCells.push(c('▀', 8, 0));
  shadowCells.push(c('║',11,0));
  rows.push(shadowCells);

  row(fill('║' + ' '.repeat(W-2) + '║', 11, 0));

  // Tagline
  const tag = '[ CRACK THE GRID OR GET FLATLINED ]';
  const tpad = Math.floor((W-2-tag.length)/2);
  const tagLine = [c('║',11,0)];
  for (let i = 0; i < tpad; i++) tagLine.push(c(' ',0,0));
  for (const ch of tag) {
    if (ch === '[' || ch === ']') tagLine.push(c(ch,14,0));
    else tagLine.push(c(ch,3,0));
  }
  while (tagLine.length < W-1) tagLine.push(c(' ',0,0));
  tagLine.push(c('║',11,0));
  rows.push(tagLine);

  // Divider
  row(fill('╠' + '═'.repeat(W-2) + '╣', 11, 0));

  // Info block
  const infos = [
    { label: 'GENRE ', val: 'CYBERPUNK DOOR GAME / BBS RPG', fc: 11 },
    { label: 'STYLE ', val: 'INSPIRED BY LORD (1989) - SETH ABLE', fc: 13 },
  ];

  for (const info of infos) {
    const cells = [c('║',11,0), c(' ',0,0)];
    const labelStr = '  ' + info.label + ' ░░ ';
    for (const ch of labelStr) cells.push(c(ch, 8, 0));
    for (const ch of info.val) cells.push(c(ch, info.fc, 0));
    while (cells.length < W-1) cells.push(c(' ',0,0));
    cells.push(c('║',11,0));
    rows.push(cells.slice(0,W));
  }

  row(fill('╠' + '═'.repeat(W-2) + '╣', 11, 0));

  // ASCII city skyline
  const skyline = [
    '                ▄█▄    ▄▄   ▄█▄▄   ▄▄▄    ▄▄  ▄▄▄▄▄  ▄▄▄              ',
    '   ▄▄▄   ▄▄▄  ████▄  ████ ██████ █████  ████ ██████ █████   ▄▄▄▄      ',
    '  █████ █████ ██████ ████ ████████████ ██████ ██████▐██████ ██████     ',
    '  ████████████████████████████████████████████████████████████████████  ',
  ];
  for (const sl of skyline) {
    const cells = [c('║',11,0)];
    const padded = sl.padEnd(W-2);
    for (const ch of padded.slice(0,W-2)) {
      if (ch === '█') cells.push(c('█', 8, 0));
      else if (ch === '▄') cells.push(c('▄', 8, 0));
      else if (ch === '▐') cells.push(c('▐', 8, 0));
      else cells.push(c(' ', 0, 0));
    }
    cells.push(c('║',11,0));
    rows.push(cells.slice(0,W));
  }

  // Neon ground line
  const groundCells = [c('║',11,0)];
  for (let i = 0; i < W-2; i++) {
    groundCells.push(c(i%3===0?'░':i%3===1?'▒':'▓', i<W/3?13:i<2*W/3?5:13, 0));
  }
  groundCells.push(c('║',11,0));
  rows.push(groundCells);

  row(fill('╠' + '═'.repeat(W-2) + '╣', 11, 0));

  // Credits / shoutouts
  text('║  GREETINGS TO :: SKYCRZR  ::  KBANG  ::  EOG  ::                       ║', 14, 0);
  text('║               :: PRONG  ::  MUSTANG SALLY  ::  BUZZBOMB  ::            ║', 14, 0);
  text('║               :: CHEESE  ::  CAM  ::  RALPH  ::                        ║', 14, 0);
  text('║               :: WINDWARD PASS  ::  ALL RUNNERS ON THE GRID  ::         ║', 13, 0);
  text('║               :: LEGEND OF THE RED DRAGON (LORD - 1989)  ::             ║', 5, 0);
  text('║               :: EVERYONE WHO EVER DIALED IN AT 2400 BAUD ::            ║', 13, 0);

  row(fill('╠' + '═'.repeat(W-2) + '╣', 11, 0));

  // Menu prompt
  const promptCells = [c('║',11,0)];
  const promptStr = '           >>> PRESS ANY KEY TO JACK INTO THE GRID <<<           ';
  for (let i = 0; i < W-2; i++) {
    const ch = promptStr[i] || ' ';
    if (ch === '>') promptCells.push(c(ch, 14, 0));
    else if (ch === '<') promptCells.push(c(ch, 14, 0));
    else promptCells.push(c(ch, 15, 0));
  }
  promptCells.push(c('║',11,0));
  rows.push(promptCells);

  const blinkCells = [c('║',11,0)];
  const blinkStr = '                        ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄                    ';
  for (let i = 0; i < W-2; i++) {
    blinkCells.push(c((blinkStr[i]||' '), 3, 0));
  }
  blinkCells.push(c('║',11,0));
  rows.push(blinkCells);

  // Bottom border
  row(fill('╚' + '═'.repeat(W-2) + '╝', 11, 0));

  return rows;
})();

// ─── SCENE HEADERS ────────────────────────────────────────────────────────────
// Smaller header art for each game location

function makeHeader(title, subtitle, color=11, accent=3) {
  const W = 78;
  const rows = [];
  const border = (ch, c1=11) => {
    const cells = [];
    for (let i = 0; i < W; i++) cells.push(c(ch, c1, 0));
    return cells;
  };

  // Top
  rows.push(border(' ', 0));
  const topRow = Array(W).fill(null).map((_,i) =>
    i===0 ? c('╔',color,0) : i===W-1 ? c('╗',color,0) : c('═',color,0)
  );
  rows.push(topRow);

  // Title row
  const titleRow = [c('║',color,0)];
  const pad = Math.floor((W-2-title.length)/2);
  for (let i = 0; i < pad; i++) titleRow.push(c(' ',0,0));
  for (const ch of title) {
    titleRow.push(c(ch, 15, 0));
  }
  while (titleRow.length < W-1) titleRow.push(c(' ',0,0));
  titleRow.push(c('║',color,0));
  rows.push(titleRow);

  // Subtitle
  if (subtitle) {
    const subRow = [c('║',color,0)];
    const spad = Math.floor((W-2-subtitle.length)/2);
    for (let i = 0; i < spad; i++) subRow.push(c('▒',8,0));
    for (let i = 0; i < subtitle.length; i++) subRow.push(c(subtitle[i], accent, 0));
    while (subRow.length < W-1) subRow.push(c('▒',8,0));
    subRow.push(c('║',color,0));
    rows.push(subRow);
  }

  // Bottom
  const botRow = Array(W).fill(null).map((_,i) =>
    i===0 ? c('╚',color,0) : i===W-1 ? c('╝',color,0) : c('═',color,0)
  );
  rows.push(botRow);
  rows.push(border(' ', 0));

  return rows;
}

// Pre-built scene headers
const HEADERS = {
  grid:    makeHeader('[ THE GRID ]', '// jack in. crack ICE. survive.', 11, 3),
  refuge:  makeHeader('[ THE NEON REFUGE ]', '// synth-whiskey & encrypted secrets', 13, 5),
  market:  makeHeader('[ BLACK MARKET ]', '// no questions asked', 10, 2),
  dungeon: makeHeader('[ DEEP GRID RUNS ]', '// abandon all hope ye who jack in here', 12, 4),
  pvp:     makeHeader('[ HIT LIST ]', '// every runner is a target', 14, 6),
  profile: makeHeader('[ RUNNER PROFILE ]', '// your legend, your legacy', 9, 1),
  world:   makeHeader('[ THE WORLD ]', '// you are not alone on the grid', 13, 5),
  quests:  makeHeader('[ DAILY MISSIONS ]', '// the grid demands your attention', 14, 6),
};

// ─── RENDER GRID ──────────────────────────────────────────────────────────────
function AnsiGrid({ rows, scale = 1 }) {
  if (!rows || rows.length === 0) return null;
  const cw = Math.floor(CELL_W * scale);
  const ch = Math.floor(CELL_H * scale);
  const fontSize = Math.max(6, Math.floor(13 * scale));

  return (
    <div style={{
      fontFamily: '"Perfect DOS VGA 437", "Courier New", monospace',
      fontSize,
      lineHeight: `${ch}px`,
      display: 'inline-block',
      background: '#000',
      letterSpacing: 0,
    }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', height: ch, whiteSpace: 'pre' }}>
          {(row || []).map((cell, ci) => (
            <span key={ci} style={{
              color: CGA[cell.fg] || '#aaa',
              background: CGA[cell.bg] || '#000',
              width: cw,
              height: ch,
              display: 'inline-block',
              textAlign: 'center',
              lineHeight: `${ch}px`,
              fontSize,
              flexShrink: 0,
              overflow: 'hidden',
            }}>
              {cell.ch}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}


// ─── MAIN ────────────────────────────────────────────────────────────────────

// New intro screen using the ANSI grid renderer
function AnsiIntroScreen({ onDone }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Small delay so the black screen flashes briefly first (authentic BBS feel)
    const t = setTimeout(() => setVisible(true), 300);
    const handleKey = () => onDone();
    window.addEventListener('keydown', handleKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', handleKey); };
  }, []);

  return (
    <div
      onClick={onDone}
      style={{
        position: 'fixed', inset: 0, background: '#000',
        zIndex: 10000, cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Scanlines */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2,
        background: 'repeating-linear-gradient(0deg,transparent,transparent 1px,rgba(0,255,0,0.018) 1px,rgba(0,255,0,0.018) 2px)',
      }} />
      {/* Vignette */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3,
        background: 'radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,0.5) 100%)',
      }} />

      {/* Top status bar */}
      <div style={{
        flexShrink: 0, padding: '3px 12px',
        background: '#00aaaa', color: '#000',
        fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
        letterSpacing: '.12em', display: 'flex', justifyContent: 'space-between', zIndex: 4,
      }}>
        <span>NETRUNNER v1.2</span>
        <span>[ CLICK OR PRESS ANY KEY TO CONTINUE ]</span>
      </div>

      {/* ANSI art — centered, scrollable if needed */}
      <div style={{
        flex: 1, overflow: 'auto', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center',
        padding: '8px 0', zIndex: 1,
        opacity: visible ? 1 : 0, transition: 'opacity 0.4s',
      }}>
        <div style={{ transform: 'scale(0.85)', transformOrigin: 'top center' }}>
          <AnsiGrid rows={TITLE_ROWS} scale={1} />
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
        flexShrink: 0, padding: '3px 12px',
        background: '#000', color: '#555555',
        fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
        borderTop: '1px solid #00aaaa',
        display: 'flex', justifyContent: 'space-between',
        letterSpacing: '.1em', zIndex: 4,
      }}>
        <span>WINDWARD PASS  //  ALL NODES OPEN</span>
        <span style={{ color: '#55ff55' }}>RUNNING AT FULL SPEED</span>
      </div>
    </div>
  );
}

function RunnersPanel({ player, onViewProfile }) {
  const [runners, setRunners] = React.useState([]);
  const [page, setPage] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const PER_PAGE = 20;
  React.useEffect(() => {
    fetch('/api/runners').then(r=>r.json()).then(data=>{setRunners(data||[]);setLoading(false);}).catch(()=>setLoading(false));
  }, []);
  const totalPages = Math.ceil(runners.length / PER_PAGE);
  const pageRunners = runners.slice(page * PER_PAGE, (page+1) * PER_PAGE);
  if (loading) return <div className="dim" style={{padding:20,textAlign:"center"}}>//  Loading runners...</div>;
  if (!runners.length) return <div className="dim" style={{padding:20,textAlign:"center"}}>//  No runners found.</div>;
  return (
    <div>
      <div style={{fontSize:12,color:"#555",marginBottom:8}}>{runners.length} runners registered</div>
      <div className="lb-header"><div>#</div><div>RUNNER</div><div style={{textAlign:"right"}}>LEVEL</div><div style={{textAlign:"right"}}>KILLS</div><div style={{textAlign:"right"}}>CREDITS</div></div>
      {pageRunners.map((r,i) => {
        const cls = CLASSES[r.cls];
        const isYou = r.name === player.name;
        return (
          <div key={i} className={"lb-row"+(isYou?" you":"")}>
            <div className="lb-rank">{page*PER_PAGE+i+1}</div>
            <div className="lb-name clickable-name" style={{color:isYou?"#fff":cls?.color}} onClick={()=>onViewProfile(r.name,r.cls)}>{cls?.icon} {r.name}{isYou?" (you)":""}</div>
            <div className="lb-val">{r.level}</div>
            <div className="lb-val">{r.kills||0}</div>
            <div className="lb-val" style={{color:"#ffff55"}}>&#8353;{r.credits||0}</div>
          </div>
        );
      })}
      {totalPages>1 && <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:12}}>
        <button className="btn btn-sm" onClick={()=>setPage(p=>Math.max(0,p-1))} disabled={page===0}>PREV</button>
        <span className="dim" style={{lineHeight:"2"}}>Page {page+1}/{totalPages}</span>
        <button className="btn btn-sm" onClick={()=>setPage(p=>Math.min(totalPages-1,p+1))} disabled={page===totalPages-1}>NEXT</button>
      </div>}
    </div>
  );
}

export default function Netrunner() {
  const [screen, setScreen] = useState("title");
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [authHandle, setAuthHandle] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirm, setAuthConfirm] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [player, setPlayer] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const [selectedClass, setSelectedClass] = useState("netrunner");
  const [narration, setNarration] = useState("");
  const [narLoading, setNarLoading] = useState(false);
  const [enemy, setEnemy] = useState(null);
  const [combatLog, setCombatLog] = useState([]);
  const [killScreen, setKillScreen] = useState(null);
  const [combatStats, setCombatStats] = useState({ dmgDealt:0, dmgTaken:0, rounds:0, crits:0, loot:0 }); // { enemy, dmgDealt, dmgTaken, rounds, crits, loot, narration }
  const [tab, setTab] = useState("");
  const [refugeTab, setRefugeTab] = useState("bar");
  const [glitch, setGlitch] = useState(false);
  const [npcWho, setNpcWho] = useState(null);
  const [npcText, setNpcText] = useState("");
  const [npcLoading, setNpcLoading] = useState(false);
  const [activeEvent, setActiveEvent] = useState(null);
  const [eventResolved, setEventResolved] = useState(false);
  const [eventDetail, setEventDetail] = useState("");
  const [pendingEnemy, setPendingEnemy] = useState(null);
  const [pvpTarget, setPvpTarget] = useState(null);
  const [pvpLog, setPvpLog] = useState([]);
  const [pvpOutcome, setPvpOutcome] = useState(null);
  const [pvpLoot, setPvpLoot] = useState(0);
  const [showPerkModal, setShowPerkModal] = useState(false);
  const [lbData, setLbData] = useState(null);
  const [lbLoading, setLbLoading] = useState(false);
  const [scoreSubmitted, setScoreSubmitted] = useState(false);
  const [lbTab, setLbTab] = useState("current");
  const [factionData, setFactionData] = useState(null);
  const [factionChatMsgs, setFactionChatMsgs] = useState([]);
  const [factionChatInput, setFactionChatInput] = useState("");
  const [factionChatLoading, setFactionChatLoading] = useState(false);
  const [factionChatCooldown, setFactionChatCooldown] = useState(0);
  const [streakModal, setStreakModal] = useState(null);
  const [profileTarget, setProfileTarget] = useState(null);   // { name, cls } being viewed
  const [profileData, setProfileData] = useState(null);        // loaded profile
  const [profileMsgs, setProfileMsgs] = useState([]);
  const [profileMsgInput, setProfileMsgInput] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLyra, setProfileLyra] = useState("");
  const [attackLog, setAttackLog] = useState([]);
  const [lyraMarriage, setLyraMarriage] = useState(null);
  const [lyraMarriageLoaded, setLyraMarriageLoaded] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [transmission, setTransmission] = useState(null);
  const [helpScreen, setHelpScreen] = useState(null);
  const [achievementQueue, setAchievementQueue] = useState([]);
  const [collectiveChat, setCollectiveChat] = useState([]);
  const [collectiveChatInput, setCollectiveChatInput] = useState("");
  const [collectiveChatLoading, setCollectiveChatLoading] = useState(false);
  const [collectiveEligible, setCollectiveEligible] = useState(false); // { title, color, body, type }      // offline attacks since last login
  const [activeDungeon, setActiveDungeon] = useState(null);   // current dungeon def
  const [dungeonRoom, setDungeonRoom] = useState(0);          // 0-4
  const [dungeonLoot, setDungeonLoot] = useState([]);         // accumulated loot [{credits,xp,item?}]
  const [dungeonLog, setDungeonLog] = useState([]);           // narrative log
  const [dungeonPhase, setDungeonPhase] = useState("idle");   // idle|combat|result|complete|failed // { streak, milestone, streakBroken }
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatLastSent, setChatLastSent] = useState(0);
  const [chatCooldown, setChatCooldown] = useState(0);
  const chatFeedRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
   const init = async () => {
     // Try server first — source of truth
     let saved = null;
     try { saved = await loadPlayer(); } catch {}
     // Fall back to localStorage
     if (!saved) saved = loadState();
     if (!saved) return;

     const today = new Date().toDateString();
     if (saved.lastReset !== today) {
       saved.turnsLeft = (MAX_TURNS || 10) + (saved.bonusTurns || 0);
       saved.hp = Math.min(saved.hp + 30, saved.maxHp);
       saved.lastReset = today;
       saved.quests = generateDailyQuests(today, saved.cls);
       saved.questStats = {};
       saved._rampageAtk = 0;
     }
     if (!saved.statusEffects) saved.statusEffects = [];
     if (!saved.abilityCooldown) saved.abilityCooldown = 0;
     if (!saved.lyraFlirtCount) saved.lyraFlirtCount = 0;
     if (!saved.pvpWins) saved.pvpWins = 0;
     if (!saved.pvpLosses) saved.pvpLosses = 0;
     if (!saved.bounties) saved.bounties = [];
     if (!saved.runners) saved.runners = generateRunners(saved.level);
     if (!saved.perks) saved.perks = [];
     if (saved.perkPoints === undefined) saved.perkPoints = 0;
     if (!saved.inventory) saved.inventory = [];
     if (!saved.combatEffects) saved.combatEffects = [];
     if (!saved.quests || saved.quests.length === 0) saved.quests = generateDailyQuests(new Date().toDateString(), saved.cls);
     if (!saved.questStats) saved.questStats = {};
     if (saved.factionId === undefined) saved.factionId = null;
     if (!saved.factionXP) saved.factionXP = 0;
     if (!saved.factionJoinedAt) saved.factionJoinedAt = null;
     if (!saved.loginStreak) saved.loginStreak = 0;
     if (!saved.longestStreak) saved.longestStreak = 0;
     if (!saved.loginHistory) saved.loginHistory = [];
     if (!saved.badges) saved.badges = [];
     if (!saved.dungeonTitles) saved.dungeonTitles = [];
     if (!saved.dungeonsCleared) saved.dungeonsCleared = [];
     if (saved.rep === undefined) saved.rep = 0;
     if (!saved.gridRating) saved.gridRating = { entertainment: 0, threat: 0, survival: 0 };
     if (saved.sponsor === undefined) saved.sponsor = null;
     if (saved.interventionPending === undefined) saved.interventionPending = null;
     if (!saved.inCollective) saved.inCollective = false;
     if (!saved.collectiveCycle) saved.collectiveCycle = null;
     if (!saved.carePackagesSent) saved.carePackagesSent = 0;
     if (!saved.lastFlirtDate) saved.lastFlirtDate = null;
     if (!saved.lyraMarried) saved.lyraMarried = false;
     if (!saved.lyraFreedrinks) saved.lyraFreedrinks = false;
     if (!saved.deaths) saved.deaths = 0;
     if (!saved.consecutiveFled) saved.consecutiveFled = 0;
     if (!saved.chatCount) saved.chatCount = 0;
     if (!saved.bonusTurns) saved.bonusTurns = 0;
     if (!saved.bonusCrit) saved.bonusCrit = 0;

     // Streak calculation
     const { saved: streaked, milestone, isNewDay, streakBroken } = calcStreakOnLogin(saved);
     let finalSaved = streaked;
     if (milestone) finalSaved = applyStreakReward(finalSaved, milestone);

     saveState(finalSaved);
     setPlayer(finalSaved);
     setScreen("hub");
     setNarration(`Welcome back, ${finalSaved.name}. The grid never sleeps.`);

     // Check achievements on login
     const withAchievements = unlockAchievements(finalSaved);
     if ((withAchievements.badges||[]).length !== (finalSaved.badges||[]).length) {
       save(withAchievements);
     }

     // Offline attack log
     popAttackLog(finalSaved.name, finalSaved.cls).then(log => {
       if (log && log.length > 0) {
         setAttackLog(log);
         const gotPackage = log.some(e => e.isGift);
         if (gotPackage) {
           const p = unlockAchievements(finalSaved, { receivedPackage: true });
           if ((p.badges||[]).length !== (finalSaved.badges||[]).length) save(p);
         }
       }
     });

     // Grid activity feed
     loadGridActivity().then(feed => {
       if (feed && feed.length > 0) setGridActivity(feed);
     });

     // Lyra marriage state
     getLyraMarriage().then(m => { setLyraMarriage(m||null); setLyraMarriageLoaded(true); });

     // Streak modal
     if (isNewDay) {
       setStreakModal({ streak: finalSaved.loginStreak, milestone, streakBroken, longestStreak: finalSaved.longestStreak });
     }
   };
   init();
 }, []);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [combatLog]);

  // ── KEYBOARD SHORTCUTS ───────────────────────────────────────────────────────
  // Use a ref so the handler always has fresh state without re-registering
  const keyStateRef = useRef({});
  useEffect(() => {
    keyStateRef.current = {
      screen, tab, showPerkModal, streakModal, profileTarget, attackLog,
      showOnboarding, transmission, helpScreen, player,
      dungeonPhase, eventResolved, lbData, factionData, narLoading,
    };
  });

  useEffect(() => {
    const handler = (e) => {
      const {
        screen, tab, showPerkModal, streakModal, profileTarget, player,
        dungeonPhase, eventResolved, lbData, factionData, narLoading,
      } = keyStateRef.current;

      // Never intercept typing in any input
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (active.isContentEditable) return;
      }

      if (showPerkModal || streakModal) return;
      if (keyStateRef.current.helpScreen) {
        e.preventDefault(); setHelpScreen(null); return;
      }
      if (keyStateRef.current.showOnboarding) {
        e.preventDefault(); setShowOnboarding(false); return;
      }
      if (keyStateRef.current.transmission) {
        e.preventDefault(); setTransmission(null); return;
      }
      if (profileTarget) {
        if (key === "Escape") { e.preventDefault(); closeProfile(); return; }
        return; // block other keys while profile is open
      }
      // Attack log blocks all keys except dismiss
      const { attackLog: aLog } = keyStateRef.current;
      if (aLog && aLog.length > 0) {
        if (key === "Escape" || key.toLowerCase() === "c") { e.preventDefault(); setAttackLog([]); }
        return;
      }
      if (narLoading) return;

      const key = e.key;
      const k = key.toLowerCase();

      // Title screen — A to start
      if (screen === "title") {
        if (k === "n") { e.preventDefault(); setAuthMode("register"); setAuthError(""); setScreen("auth"); return; }
        if (k === "j" || k === "a" || key === "Enter") { e.preventDefault(); setAuthMode("login"); setAuthError(""); setScreen("auth"); return; }
      }
      if (screen === "auth") return; // input fields handle their own keys

      // Create screen — 1/2/3 to pick class, Enter to confirm
      if (screen === "create") {
        const classes = Object.keys(CLASSES);
        if (k === "1") { e.preventDefault(); setSelectedClass(classes[0]); return; }
        if (k === "2") { e.preventDefault(); setSelectedClass(classes[1]); return; }
        if (k === "3") { e.preventDefault(); setSelectedClass(classes[2]); return; }
      }

      // ? opens context help from any hub screen
      if (screen === "hub" && key === "?") {
        e.preventDefault();
        const helpMap = {
          "": "main", grid: "grid", dungeons: "dungeons",
          quests: "quests", refuge: "refuge", market: "market",
          runner: "runner", world: "world", world_leaderboard: "world",
          world_rivals: "world", world_faction: "faction",
          runner_faction: "faction", runner_skills: "runner",
          runner_inventory: "market",
        };
        setHelpScreen(helpMap[tab] || "main");
        return;
      }

      // Main menu letter keys
      if (screen === "hub" && !tab) {
        const map = {
          g: () => setTab("grid"),
          d: () => setTab("dungeons"),
          q: () => setTab("quests"),
          r: () => setTab("refuge"),
          m: () => setTab("market"),
          p: () => setTab("runner"),
          w: () => { setTab("world"); if (!lbData) fetchLeaderboard(); if (!factionData) fetchFactionData(); },
        };
        if (map[k]) { e.preventDefault(); map[k](); return; }
      }

      // ESC = go back
      if (key === "Escape" && screen === "hub" && tab) {
        e.preventDefault();
        if (tab.startsWith("runner_")) setTab("runner");
        else if (tab.startsWith("world_")) setTab("world");
        else setTab("");
        return;
      }

      // Grid
      if (screen === "hub" && tab === "grid" && (k === "g" || key === "Enter")) { e.preventDefault(); handleEnterGrid(); return; }

      // Runner sub-menu
      if (screen === "hub" && tab === "runner") {
        const map = { i: () => setTab("runner_inventory"), s: () => setTab("runner_skills"), f: () => setTab("runner_faction") };
        if (map[k]) { e.preventDefault(); map[k](); return; }
      }

      // World sub-menu
      if (screen === "hub" && tab === "world") {
        const map = {
          l: () => { setTab("world_leaderboard"); if (!lbData) fetchLeaderboard(); },
          h: () => { setTab("world_rivals"); if (!player?.runners) refreshRunners(player); },
          f: () => { setTab("world_faction"); if (!factionData) fetchFactionData(); },
        };
        if (map[k]) { e.preventDefault(); map[k](); return; }
      }

      // Combat
      if (screen === "combat") {
        if (k === "a") { e.preventDefault(); handleAttack(); return; }
        if (k === "s" && player?.abilityCooldown === 0) { e.preventDefault(); handleAbility(); return; }
        if (k === "f" || key === "Escape") { e.preventDefault(); handleJackOut(); return; }
      }

      // Dungeon
      if (screen === "dungeon") {
        if (k === "f" && dungeonPhase === "combat")   { e.preventDefault(); handleDungeonFight(); return; }
        if (k === "n" && dungeonPhase === "result")    { e.preventDefault(); handleDungeonNextRoom(); return; }
        if (k === "c" && dungeonPhase === "complete")  { e.preventDefault(); handleDungeonCollect(); return; }
        if (key === "Escape")                          { e.preventDefault(); handleDungeonFlee(); return; }
      }

      // PvP
      if (screen === "pvp") {
        if (k === "f") { e.preventDefault(); handlePvpFight(); return; }
        if (key === "Escape") { e.preventDefault(); setScreen("hub"); setTab("world_rivals"); return; }
      }

      // Event
      if (screen === "event" && eventResolved) {
        if (key === "Enter" || k === "c") { e.preventDefault(); handleEventContinue(); return; }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const save = (p) => {
    saveState(p);
    setPlayer(p);
    savePlayer(p).catch(() => {});
    // Keep shared profile data up to date
    saveProfileData(p).catch(() => {});
  };
  const triggerGlitch = () => { setGlitch(true); setTimeout(() => setGlitch(false), 400); };

  // Track quest progress — call with (player, stat, amount)
  const trackQuest = (p, stat, amount = 1) => {
    const qs = { ...(p.questStats || {}), [stat]: ((p.questStats || {})[stat] || 0) + amount };
    const updatedQuests = advanceQuest(p.quests || [], stat, amount);
    return { ...p, questStats: qs, quests: updatedQuests };
  };

  const narrate = async (prompt) => {
    setNarLoading(true);
    try { setNarration(await getNarration(prompt)); } catch { setNarration("// ERROR: Signal fragmented."); }
    setNarLoading(false);
  };

  const npcSay = async (who, prompt) => {
    setNpcWho(who); setNpcText(""); setNpcLoading(true);
    try { setNpcText(await getNarration(prompt)); } catch { setNpcText("// Signal noise."); }
    setNpcLoading(false);
  };

  // ── CREATE ──────────────────────────────────────────────────────────────────
  // ── AUTH ─────────────────────────────────────────────────────────────────────
  const handleLogin = async () => {
    if (!authHandle.trim() || !authPassword) { setAuthError("Enter your handle and password."); return; }
    setAuthLoading(true); setAuthError("");
    try {
      const { login, IS_ARTIFACT_MODE } = await import('./api.js');
      if (IS_ARTIFACT_MODE) {
        // Artifact mode — no real auth, just load from localStorage
        const saved = loadState();
        if (!saved || saved.name.toLowerCase() !== authHandle.trim().toLowerCase()) {
          setAuthError("// Handle not found. Check your handle or create a new runner.");
          setAuthLoading(false); return;
        }
        setPlayer(saved); setScreen("hub");
        setAuthLoading(false); return;
      }
      const data = await login(authHandle.trim(), authPassword);
      if (data.error) { setAuthError(`// ${data.error}`); setAuthLoading(false); return; }
      if (data.player) {
        const p = data.player;
        // Run daily reset
        const today = new Date().toDateString();
        if (p.lastReset !== today) {
          p.turnsLeft = 10; p.hp = Math.min(p.hp + 30, p.maxHp);
          p.lastReset = today; p.questStats = {};
        }
        saveState(p);
        setPlayer(p); setScreen("hub");
        setNarration(`Welcome back, ${p.name}. The grid never sleeps.`);
      }
    } catch (e) { setAuthError("// Connection failed. Try again."); }
    setAuthLoading(false);
  };

  const handleRegister = async () => {
    if (!authHandle.trim()) { setAuthError("Choose a handle."); return; }
    if (!authPassword) { setAuthError("Choose a password."); return; }
    if (authPassword.length < 6) { setAuthError("Password must be at least 6 characters."); return; }
    if (authPassword !== authConfirm) { setAuthError("Passwords don't match."); return; }
    setAuthLoading(true); setAuthError("");
    try {
      const { register, IS_ARTIFACT_MODE } = await import('./api.js');
      if (IS_ARTIFACT_MODE) {
        // Artifact mode — skip to class selection
        setScreen("create");
        setNameInput(authHandle.trim());
        setAuthLoading(false); return;
      }
      const data = await register(authHandle.trim(), authPassword, selectedClass);
      if (data.error) { setAuthError(`// ${data.error}`); setAuthLoading(false); return; }
      if (data.player) {
        saveState(data.player);
        setPlayer(data.player);
        setShowOnboarding(true);
        setScreen("hub");
      }
    } catch (e) { setAuthError("// Connection failed. Try again."); }
    setAuthLoading(false);
  };

  const handleCreate = async () => {
    if (!nameInput.trim()) return;
    const p = newPlayer(nameInput.trim(), selectedClass);
    save(p);
    await narrate(`${p.name} just jacked into the grid for the first time as a ${CLASSES[selectedClass].name}. Describe their first neon-soaked connection in 2 vivid sentences.`);
    setScreen("hub");
    setShowOnboarding(true);
  };

  // ── DUNGEONS ─────────────────────────────────────────────────────────────────
  const handleEnterDungeon = async (dungeon) => {
    if (player.turnsLeft < DUNGEON_TURN_COST) { setNarration(`// INSUFFICIENT TURNS — Dungeons cost ${DUNGEON_TURN_COST} turns to enter.`); return; }
    if (player.level < dungeon.levelReq) { setNarration(`// ACCESS DENIED — Requires Rank ${dungeon.levelReq}.`); return; }
    const p = { ...player, turnsLeft: player.turnsLeft - DUNGEON_TURN_COST };
    save(p);
    setActiveDungeon(dungeon);
    setDungeonRoom(0);
    setDungeonLoot([]);
    setDungeonLog([]);
    setDungeonPhase("combat");
    setScreen("dungeon");
    await narrate(`${p.name} jacks into ${dungeon.name}. ${dungeon.desc} Room 1: ${dungeon.rooms[0].name}. Describe entering this dungeon in 2 atmospheric sentences.`);
  };

  const handleDungeonFight = async () => {
    const room = activeDungeon.rooms[dungeonRoom];
    const rawEnemy = getDungeonEnemy(room);
    const e = { ...rawEnemy, currentHp: rawEnemy.hp, statusEffects: [] };
    const log = [];

    // Run full combat simulation (instant, like PvP)
    const { won, log: fightLog, finalAHp } = simulatePvpCombat(
      { ...player, atk: calcAtk(player), def: calcDef(player) },
      { ...e, handle: e.name }
    );
    const entries = [...dungeonLog, ...fightLog.map(l => ({ ...l }))];

    if (won) {
      // Collect loot for this room
      const lootEntry = { credits: rawEnemy.credits, xp: rawEnemy.xp };
      const drop = rollDrop(room.enemyLevel || 1, room.boss);
      if (drop) lootEntry.item = drop;
      const newLoot = [...dungeonLoot, lootEntry];

      if (room.boss) {
        entries.push({ type: "room-boss", text: `[BOSS] ${e.name} flatlined! Room cleared.` });
      } else {
        entries.push({ type: "room-clear", text: `[CLEAR] ${room.name} secured. Loot cached.` });
      }
      if (drop) entries.push({ type: "room-loot", text: `[LOOT] ${CONSUMABLES[drop]?.icon} ${CONSUMABLES[drop]?.name} found!` });

      setDungeonLoot(newLoot);
      setDungeonLog(entries);

      // Update player HP from fight
      const updatedPlayer = { ...player, hp: Math.max(1, finalAHp) };
      save(updatedPlayer);

      if (room.boss) {
        // Dungeon complete!
        setDungeonPhase("complete");
        await narrate(`${player.name} destroys ${e.name} and clears ${activeDungeon.name}. Describe this legendary victory in 2 sentences.`);
      } else {
        setDungeonPhase("result");
        await narrate(`${player.name} clears ${room.name} in ${activeDungeon.name}, HP at ${finalAHp}. One more room ahead. 1 tense sentence.`);
      }
    } else {
      // Dungeon failed — lose all cached loot
      entries.push({ type: "room-dmg", text: `[FLATLINED] Connection severed. All cached loot lost.` });
      setDungeonLog(entries);
      const updatedPlayer = { ...player, hp: Math.max(1, Math.floor(player.hp * 0.3)) };
      save(updatedPlayer);
      setDungeonPhase("failed");
      await narrate(`${player.name} gets flatlined in ${room.name} and loses all cached dungeon loot. Describe the brutal defeat in 2 sentences.`);
    }
  };

  const handleDungeonNextRoom = async () => {
    const nextRoom = dungeonRoom + 1;
    setDungeonRoom(nextRoom);
    setDungeonPhase("combat");
    const room = activeDungeon.rooms[nextRoom];
    await narrate(`${player.name} pushes into ${room.name}${room.boss ? " — the boss chamber" : ""}. ${room.boss ? "Describe the final encounter in 2 menacing sentences." : "Describe entering the next room in 1 sentence."}`);
  };

  const handleDungeonCollect = () => {
    // Apply all cached loot to player
    let p = { ...player };
    let totalCredits = 0, totalXp = 0;
    const items = [];

    for (const loot of dungeonLoot) {
      totalCredits += loot.credits;
      totalXp += loot.xp;
      if (loot.item) {
        const { inv, added } = addToInventory(p.inventory, loot.item);
        if (added) { p.inventory = inv; items.push(loot.item); }
      }
    }

    p.credits += totalCredits;
    p.xp += totalXp;

    // Bonus FXP for dungeon clear
    if (p.factionId) {
      p.factionXP = (p.factionXP || 0) + FXP_TABLE.dungeonClear;
      contributeFactionXP(p.factionId, FXP_TABLE.dungeonClear).then(d => { if (d) setFactionData(d); });
    }
    // Grid rating
    p = applyRatingEvent(p, "dungeon_clear");
    p = checkAndShowIntervention(p);

    // Award dungeon title
    const title = activeDungeon.titleReward;
    if (!p.dungeonTitles.includes(title)) p.dungeonTitles = [...(p.dungeonTitles || []), title];
    if (!p.dungeonsCleared.includes(activeDungeon.id)) p.dungeonsCleared = [...(p.dungeonsCleared || []), activeDungeon.id];

    // Level-up check
    while (p.xp >= XP_PER_LEVEL(p.level)) {
      p.xp -= XP_PER_LEVEL(p.level);
      p.level++; p.maxHp += 15; p.hp = p.maxHp; p.atk += 2; p.def++;
      if (p.level % 2 === 0) p.perkPoints = (p.perkPoints || 0) + 1;
    }

    save(p);
    setActiveDungeon(null);
    setDungeonPhase("idle");
    setScreen("hub");
    setTab("");
    postSystemMessage(`${p.name} cleared ${activeDungeon.name} and earned the title [${title}]`);
  };

  const handleDungeonFlee = () => {
    // Flee mid-dungeon — lose all loot, cost already paid
    save({ ...player, hp: Math.max(1, Math.floor(player.hp * 0.5)) });
    setActiveDungeon(null);
    setDungeonPhase("idle");
    setDungeonLoot([]);
    setScreen("hub");
    setNarration("// SIGNAL ABORTED — You fled the dungeon. Cached loot lost. HP halved.");
  };

  // ── GRID ────────────────────────────────────────────────────────────────────
  const handleEnterGrid = async () => {
    setCombatStats({ dmgDealt:0, dmgTaken:0, rounds:0, crits:0, loot:0 });
    if (player.turnsLeft <= 0) { setNarration("DEBUG: no turns"); return; }
    let dbgEnemy;
    try { dbgEnemy = getEnemyForLevel(player.level); } catch(e) { setNarration("DEBUG: getEnemy failed: "+e.message); return; }
    if (player.turnsLeft <= 0) { setNarration("// QUOTA EXCEEDED — Neural uplink cap reached. Rest up, runner."); return; }
    const e = getEnemyForLevel(player.level);
    // Clear scout
    const p = player.scoutedEnemy ? { ...player, scoutedEnemy: null } : player;
    save(p);
    // 45% chance of a grid event before combat
    if (Math.random() < 0.45) {
      const evt = pickGridEvent(p);
      setPendingEnemy(e);
      setActiveEvent(evt);
      setEventResolved(false);
      setEventDetail("");
      setScreen("event");
      await narrate(evt.prompt(p, null));
    } else {
      setEnemy(e); setCombatLog([]); setScreen("combat");
      const scoutHint = player.scoutedEnemy ? ` Static's intel was right — a ${e.name}.` : "";
      await narrate(`${p.name} dives into the grid and encounters a ${e.name}${e.boss ? " — the legendary Megacorp AI" : ""}.${scoutHint} Describe the encounter in 2 tense sentences.`);
    }
  };

  const handleEventChoice = async (choiceId) => {
    if (eventResolved) return;
    const { p: newP, tag, detail } = activeEvent.resolve(choiceId, { ...player });
    setEventDetail(detail);
    setEventResolved(true);
    save(newP);
    // Level-up check after XP gain
    if (newP.xp >= XP_PER_LEVEL(newP.level)) {
      newP.xp -= XP_PER_LEVEL(newP.level);
      newP.level++; newP.maxHp += 15; newP.hp = newP.maxHp; newP.atk += 2; newP.def++;
      save(newP);
    }
    await narrate(activeEvent.prompt(newP, choiceId));
  };

  const handleEventContinue = async () => {
    // Proceed to combat after event
    const e = pendingEnemy;
    setActiveEvent(null); setPendingEnemy(null);
    setEnemy(e); setCombatLog([]);
    setScreen("combat");
    await narrate(`${player.name} pushes deeper and runs into a ${e.name}${e.boss ? " — the Megacorp AI" : ""}. No rest on the grid. Describe in 2 tense sentences.`);
  };

  // ── COMBAT ENGINE ───────────────────────────────────────────────────────────
  const resolveCombatRound = (p, e, log, isAbility = false, abilityResult = null) => {
    p = { ...p, statusEffects: [...(p.statusEffects || [])], combatEffects: [...(p.combatEffects || [])] };
    e = { ...e, statusEffects: [...(e.statusEffects || [])] };
    const cls = CLASSES[p.cls];

    // ── Resolve active combat item effects ──
    const atkBuff = p.combatEffects.find(fx => fx.type === "atkBuff");
    const iceBreakerFx = p.combatEffects.find(fx => fx.type === "iceBreakerDef");
    const skipFx = p.combatEffects.find(fx => fx.type === "skipEnemy");

    let playerDmg = 0, newStatusOnEnemy = null;

    if (isAbility && abilityResult) {
      playerDmg = abilityResult.dmg;
      newStatusOnEnemy = abilityResult.statusToEnemy;
      log.push({ type: "ability", text: abilityResult.log });
      p.abilityCooldown = calcAbilityCooldown(p, cls.ability.cooldown);
    } else {
      const rawAtk = calcAtk(p) + (p._rampageAtk || 0) + (atkBuff ? atkBuff.value : 0);
      let enemyDef = p._firstStrikeIgnoreDef && !p._firstStrikeDone ? 0 : calcEnemyDef(e);
      if (iceBreakerFx) enemyDef = Math.floor(enemyDef * (1 - iceBreakerFx.value));
      if (p._firstStrikeIgnoreDef && !p._firstStrikeDone) { p._firstStrikeDone = true; log.push({ type: "ability", text: `[DEATH MARK] First strike ignores DEF` }); }
      const wasCrit = Math.random() < calcCrit(p);
      const critMult = calcCritMult(p);
      const base = Math.max(1, rawAtk - enemyDef + Math.floor(Math.random() * 5) - 2);
      playerDmg = wasCrit ? Math.floor(base * critMult) : base;
      if (wasCrit) {
        log.push({ type: "crit", text: `[CRIT] ${playerDmg} dmg to ${e.name}${iceBreakerFx ? " (DEF halved)" : ""}` });
        const burnVal = p._burnCritDmg || 8;
        if (p.cls === "bruteforcer") { newStatusOnEnemy = { type: "burn", turns: 2, value: burnVal }; log.push({ type: "burn", text: `[BURN] ${e.name} ignites` }); }
        if (p._cascadeCrit && Math.random() < 0.30) {
          const cascadeDmg = Math.floor(base * 0.5);
          playerDmg += cascadeDmg;
          log.push({ type: "crit", text: `[CASCADE] Chain exploit! +${cascadeDmg} bonus dmg` });
        }
        // Quest: crits
        p.quests = advanceQuest(p.quests, "crits", 1);
        p.questStats = { ...p.questStats, crits: (p.questStats?.crits || 0) + 1 };
      } else {
        log.push({ type: "hit", text: `[ATK] ${playerDmg} dmg to ${e.name}${iceBreakerFx ? " (DEF halved)" : ""}` });
      }
      if (p.abilityCooldown > 0) p.abilityCooldown--;
    }

    // Tick combat effects
    p.combatEffects = p.combatEffects
      .map(fx => ({ ...fx, turns: fx.turns - 1 }))
      .filter(fx => fx.turns > 0);

    if (p._combatRegen) { p.hp = Math.min(p.maxHp, p.hp + p._combatRegen); }
    p.nextFightBuff = null;

    e.currentHp -= playerDmg;
    if (newStatusOnEnemy) e.statusEffects = [...e.statusEffects.filter(s => s.type !== newStatusOnEnemy.type), newStatusOnEnemy];
    const eBurn = burnDmg(e.statusEffects);
    if (eBurn > 0) { e.currentHp -= eBurn; log.push({ type: "burn", text: `[BURN] ${e.name} takes ${eBurn} burn dmg` }); }
    e.statusEffects = tickStatuses(e.statusEffects);

    if (e.currentHp <= 0) {
      const xpRaw = e.xp; const credRaw = e.credits;
      const xpGain = Math.floor(xpRaw * (1 + (p._xpBonus || 0)));
      const credGain = Math.floor(credRaw * (1 + (p._creditBonus || 0)));
      p.xp += xpGain; p.credits += credGain; p.kills++; p.turnsLeft--;
      if (p._killHeal) { p.hp = Math.min(p.maxHp, p.hp + p._killHeal); log.push({ type: "sys", text: `[LEECH] Restored ${p._killHeal} HP` }); }
      if (p._rampageKills) { p._rampageAtk = (p._rampageAtk || 0) + 3; log.push({ type: "sys", text: `[RAMPAGE] ATK +3 (total +${p._rampageAtk})` }); }
      // Loot drop
      const drop = rollDrop(e.level || 1, e.boss);
      let droppedItem = null;
      if (drop) {
        const { inv, added } = addToInventory(p.inventory, drop);
        if (added) {
          p.inventory = inv;
          droppedItem = CONSUMABLES[drop];
          log.push({ type: "sys", text: `[LOOT] ${droppedItem.icon} ${droppedItem.name} dropped!` });
          // Quest: lootPicked
          p.quests = advanceQuest(p.quests, "lootPicked", 1);
          p.questStats = { ...p.questStats, lootPicked: (p.questStats?.lootPicked || 0) + 1 };
        } else {
          log.push({ type: "sys", text: `[LOOT] ${CONSUMABLES[drop]?.name} dropped but bag is full` });
        }
      }
      // Quest: kills, creditsEarned, runs
      p.quests = advanceQuest(p.quests, "kills", 1);
      p.quests = advanceQuest(p.quests, "creditsEarned", credGain);
      p.questStats = { ...p.questStats, kills: (p.questStats?.kills || 0) + 1, creditsEarned: (p.questStats?.creditsEarned || 0) + credGain };
      // Quest: lowHpWins (finished fight < 20% HP)
      if (p.hp < p.maxHp * 0.2 && p.hp > 0) {
        p.quests = advanceQuest(p.quests, "lowHpWins", 1);
        p.questStats = { ...p.questStats, lowHpWins: (p.questStats?.lowHpWins || 0) + 1 };
      }
      // Faction XP on kill
      if (p.factionId) { p.factionXP = (p.factionXP||0) + (e.boss ? FXP_TABLE.bossKill : FXP_TABLE.kill); }
      // Grid rating
      p = applyRatingEvent(p, e.boss ? "boss_kill" : "kill");
      // Low HP dramatic win
      if (p.hp < p.maxHp * 0.2) p = applyRatingEvent(p, "low_hp_win");
      p = { ...p, consecutiveFled: 0 };
      log.push({ type: "sys", text: `[SYS] ${e.name} flatlined. +${xpGain}xp +₡${credGain}${p.factionId ? ` +${e.boss?FXP_TABLE.bossKill:FXP_TABLE.kill}FXP` : ""}` });
      let leveled = false;
      while (p.xp >= XP_PER_LEVEL(p.level)) {
        p.xp -= XP_PER_LEVEL(p.level); p.level++; p.maxHp += 15; p.hp = p.maxHp; p.atk += 2; p.def++;
        if (p.level % 2 === 0) { p.perkPoints = (p.perkPoints || 0) + 1; }
        log.push({ type: "sys", text: `[SYS] RANK UP → ${p.level}${p.level % 2 === 0 ? " — PERK POINT EARNED" : ""}` });
        leveled = true;
      }
      if (e.boss) p.bossDefeated = true;
      return { p, e: null, log, outcome: e.boss ? "boss_win" : "win", leveled, droppedItem };
    }

    // ── Enemy turn ──
    const eAtk = calcEnemyAtk(e);
    const pDef = calcDef(p);
    const abilityChance = Math.max(0, e.ability ? e.ability.chance - (p._intimidate || 0) : 0);
    if (e.ability && Math.random() < abilityChance) {
      const eff = { ...e.ability.effect };
      if (p._statusResist) eff.turns = Math.max(1, eff.turns - p._statusResist);
      if (eff.type === "traced" && p._immuneTraced) { log.push({ type: "sys", text: `[SIGNAL MASK] Trace attempt blocked` }); }
      else {
        p.statusEffects = [...p.statusEffects.filter(s => s.type !== eff.type), eff];
        log.push({ type: "status", text: `[${e.name}] ${e.ability.name} — ${eff.type.toUpperCase()} ×${eff.turns}` });
      }
    }
    // Skip enemy if decoy active
    if (skipFx && Math.random() < skipFx.value) {
      log.push({ type: "sys", text: `[DECOY] Enemy confused — skipped their attack` });
    } else {
      const eDmg = Math.max(1, eAtk - pDef + Math.floor(Math.random() * 4) - 1);
      if (p._dodgeChance && Math.random() < p._dodgeChance) {
        log.push({ type: "sys", text: `[DODGE] Evaded the attack entirely` });
      } else {
        const reduced = Math.max(0, eDmg - (p._dmgReduction || 0));
        if (p._deathShield && p.hp - reduced <= 0) {
          p._deathShield = false;
          log.push({ type: "sys", text: `[AEGIS] Death shield absorbed the killing blow` });
        } else {
          p.hp -= reduced;
          log.push({ type: "dmg", text: `[${e.name}] Counter-strike: ${reduced} dmg${p._dmgReduction ? ` (${p._dmgReduction} absorbed)` : ""}` });
        }
      }
    }
    const pBurn = burnDmg(p.statusEffects);
    if (pBurn > 0) { p.hp -= pBurn; log.push({ type: "burn", text: `[BURN] You take ${pBurn} burn dmg` }); }
    p.statusEffects = tickStatuses(p.statusEffects);

    if (p.hp <= 0) {
      p.hp = 0; p.turnsLeft--;
      log.push({ type: "dmg", text: `[SYS] CONNECTION TERMINATED — Flatlined.` });
      return { p, e: null, log, outcome: "lose" };
    }
    return { p, e, log, outcome: "ongoing" };
  };

  const handleAttack = async () => {
    const log = [...combatLog];
    const { p, e, log: newLog, outcome, leveled } = resolveCombatRound({ ...player }, { ...enemy }, log);
    setCombatLog(newLog); save(p);
    if (outcome !== "ongoing") { setEnemy(null); await handleCombatEnd(outcome, p, enemy, leveled); return; }
    setEnemy(e);
    await narrate(`${p.name} fights ${e.name}, now at ${p.hp}/${p.maxHp} HP. Narrate this exchange in 2 terse sentences.`);
  };

  const handleAbility = async () => {
    if (player.abilityCooldown > 0) return;
    const cls = CLASSES[player.cls];
    const result = cls.ability.use({ ...player }, { ...enemy });
    const log = [...combatLog];
    let { p, e, log: newLog, outcome, leveled } = resolveCombatRound({ ...player }, { ...enemy }, log, true, result);
    // Quest: abilityUses
    p = trackQuest(p, "abilityUses", 1);
    setCombatLog(newLog); save(p);
    if (outcome !== "ongoing") { setEnemy(null); await handleCombatEnd(outcome, p, enemy, leveled); return; }
    setEnemy(e);
    await narrate(`${p.name} unleashes ${cls.ability.name} against ${e.name}. Narrate this moment in 2 cinematic sentences.`);
  };

  const handleCombatEnd = async (outcome, p, lastEnemy, leveled) => {
    // Quest: runs
    p = trackQuest(p, "runs", 1);
    // Faction XP contribution (async, non-blocking)
    if (p.factionId) contributeFactionXP(p.factionId, p.factionXP ? FXP_TABLE.kill : 0).then(d => { if (d) setFactionData(d); });
    if (outcome === "win" || outcome === "boss_win") {
      p = unlockAchievements(p, { lowHpWin: p.hp < p.maxHp * 0.05 });
      save(p);
      triggerGlitch();
      const killNarration = await getNarration(`${p.name} just flatlined the ${lastEnemy.name}${lastEnemy.boss ? " — the Megacorp AI itself" : ""}. Describe the victory in 2 punchy sentences.`);
      setKillScreen({
        enemy: lastEnemy,
        dmgDealt: combatStats.dmgDealt,
        dmgTaken: combatStats.dmgTaken,
        rounds: combatStats.rounds,
        crits: combatStats.crits,
        loot: p.credits - (player.credits || 0),
        narration: killNarration,
        leveled,
      });
      if (outcome === "boss_win") {
        handleSubmitScore(p);
        postSystemMessage(`★ ${p.name} cracked the MEGACORP MAINFRAME — Rank ${p.level}, ${p.kills} kills`);
        setKillScreen(null);
        setScreen("victory"); return;
      }
      return; // Kill screen handles navigation
    } else {
      p = { ...p, deaths: (p.deaths||0) + 1 };
      p = unlockAchievements(p, { firstDeath: (p.deaths||0) === 1 });
      save(p);
      await narrate(`${p.name} was flatlined by ${lastEnemy.name}. Their signal went dark. 2 dramatic sentences.`);
      handleSubmitScore(p);
    }
    if (leveled) postSystemMessage(`◈ ${p.name} reached RANK ${p.level} on the grid`);
    if ((p.perkPoints || 0) > 0 && getAvailablePerks(p).length > 0) setShowPerkModal(true);
    setScreen("hub");
  };

  const handleJackOut = async () => {
    let p = { ...player, turnsLeft: player.turnsLeft - 1, statusEffects: [], nextFightBuff: null };
    p = trackQuest(p, "jackOuts", 1);
    p = trackQuest(p, "runs", 1);
    save(p); setEnemy(null);
    await narrate(`${player.name} aborts the run and jacks out before getting flatlined. 1 sentence.`);
    setScreen("hub");
  };

  // ── INVENTORY ────────────────────────────────────────────────────────────────
  const handleUseItem = (itemId, inCombat = false) => {
    const item = CONSUMABLES[itemId];
    if (!item) return;
    if (inCombat && !item.useInCombat) return;
    if (!inCombat && !item.useInHub) return;
    let { p: newP, combatEffect, log: itemLog } = item.use({ ...player });
    if (combatEffect) {
      newP.combatEffects = [...(newP.combatEffects || []).filter(fx => fx.type !== combatEffect.type), combatEffect];
    }
    newP.inventory = removeFromInventory(newP.inventory, itemId);
    // Quest: itemsUsed, statusCured
    newP = trackQuest(newP, "itemsUsed", 1);
    if (item.id === "smoke_grenade") newP = trackQuest(newP, "statusCured", 1);
    save(newP);
    if (inCombat) setCombatLog(prev => [...prev, { type: "sys", text: itemLog }]);
  };

  const handleSellItem = (itemId) => {
    const item = CONSUMABLES[itemId];
    if (!item) return;
    let p = { ...player, credits: player.credits + item.sellPrice, inventory: removeFromInventory(player.inventory, itemId) };
    p = trackQuest(p, "itemsSold", 1);
    save(p);
  };

  // ── CHAT ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (chatCooldown <= 0) return;
    const t = setInterval(() => setChatCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [chatCooldown]);

  const fetchChat = async () => {
    setChatLoading(true);
    try { setChatMessages(await loadChat()); } catch {}
    setChatLoading(false);
  };

  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatCooldown > 0 || chatLoading) return;
    setChatLoading(true);
    setChatInput("");
    try {
      const updated = await postChatMessage(player, text);
      setChatMessages(updated);
      setChatLastSent(Date.now());
      setChatCooldown(Math.ceil(CHAT_RATE_MS / 1000));
    } catch {}
    setChatLoading(false);
  };

  // ── QUEST CLAIM ──────────────────────────────────────────────────────────────
  const handleClaimQuest = (questId) => {
    const q = (player.quests||[]).find(q => q.id === questId);
    const def = getQuestDef(questId);
    if (!q || !def || q.claimed || q.progress < def.goal) return;
    let p = { ...player };
    p.credits += def.reward.credits;
    p.xp += def.reward.xp;
    if (def.reward.item) {
      const { inv, added } = addToInventory(p.inventory, def.reward.item);
      if (added) p.inventory = inv;
    }
    p.quests = p.quests.map(qi => qi.id === questId ? { ...qi, claimed: true } : qi);
    // Faction XP on quest claim
    if (p.factionId) { p.factionXP = (p.factionXP||0) + FXP_TABLE.questClaim; contributeFactionXP(p.factionId, FXP_TABLE.questClaim).then(d=>{if(d)setFactionData(d);}); }
    // Grid rating
    p = applyRatingEvent(p, "quest_claim");
    p = checkAndShowIntervention(p);
    save(p);
  };

  // ── FACTIONS ─────────────────────────────────────────────────────────────────
  const fetchFactionData = async () => {
    try { setFactionData(await loadFactionData()); } catch {}
  };

  const handleJoinFaction = async (factionId) => {
    if (player.factionId) {
      // Check cooldown
      const cooldownLeft = player.factionJoinedAt ? (player.factionJoinedAt + FACTION_WEEK_MS) - Date.now() : 0;
      if (cooldownLeft > 0) return;
    }
    // Strip old faction bonuses by resetting derived fields, then apply new ones
    let p = { ...player, factionId, factionXP: 0, factionJoinedAt: Date.now(),
      // Reset faction-modified derived fields
      _xpBonus: 0, _creditBonus: 0, _intimidate: 0, _abilityBonus: 0,
      _shopDiscount: 0, _pvpStealBonus: 0, _eventXpBonus: 0,
      atk: CLASSES[player.cls].atk + player.gear.reduce((s,id)=>{ const g=GEAR.find(g=>g.id===id); return s+(g?.atk||0); },0),
    };
    // Re-apply all owned perks then faction
    for (const id of (p.perks||[])) { const perk = getPerkById(id); if (perk) p = perk.apply(p); }
    p = applyFactionBonuses(p);
    save(p);
    postSystemMessage(`${p.name} joined ${FACTIONS[factionId].name} on the grid`);
    const d = await loadFactionData();
    setFactionData(d);
  };

  const handleLeaveFaction = () => {
    // Just clear — bonuses stripped on next save
    let p = { ...player, factionId: null, factionXP: 0, factionJoinedAt: null,
      _xpBonus: 0, _creditBonus: 0, _intimidate: 0, _abilityBonus: 0,
      _shopDiscount: 0, _pvpStealBonus: 0, _eventXpBonus: 0,
    };
    for (const id of (p.perks||[])) { const perk = getPerkById(id); if (perk) p = perk.apply(p); }
    save(p);
  };

  const earnFactionXP = async (p, amount) => {
    if (!p.factionId) return p;
    const fxp = amount;
    p = { ...p, factionXP: (p.factionXP||0) + fxp };
    // Contribute to weekly totals async (don't block)
    contributeFactionXP(p.factionId, fxp).then(d => { if (d) setFactionData(d); });
    return p;
  };

  const handleFactionChat = async () => {
    const text = factionChatInput.trim();
    if (!text || factionChatCooldown > 0 || factionChatLoading || !player.factionId) return;
    setFactionChatLoading(true); setFactionChatInput("");
    try {
      const msgs = await postFactionChatMsg(player, text);
      setFactionChatMsgs(msgs);
      setFactionChatCooldown(30);
    } catch {}
    setFactionChatLoading(false);
  };

  const fetchFactionChat = async () => {
    if (!player?.factionId) return;
    setFactionChatLoading(true);
    try { setFactionChatMsgs(await loadFactionChat(player.factionId)); } catch {}
    setFactionChatLoading(false);
  };

  // Faction chat cooldown ticker
  useEffect(() => {
    if (factionChatCooldown <= 0) return;
    const t = setInterval(() => setFactionChatCooldown(c => Math.max(0, c-1)), 1000);
    return () => clearInterval(t);
  }, [factionChatCooldown]);

  // ── LEADERBOARD ──────────────────────────────────────────────────────────────
  const fetchLeaderboard = async () => {
    setLbLoading(true);
    try { setLbData(await loadLeaderboard()); } catch { setLbData({ entries: [], meta: { season: 1 }, hall: [] }); }
    setLbLoading(false);
  };

  const handleSubmitScore = async (p) => {
    if (scoreSubmitted) return;
    setScoreSubmitted(true);
    try { const sorted = await submitScore(p); setLbData(d => d ? { ...d, entries: sorted } : null); } catch {}
  };

  // ── ACHIEVEMENTS ─────────────────────────────────────────────────────────────────
  const applyAchievementReward = (p, id) => {
    const a = ACHIEVEMENTS[id];
    if (!a || !a.reward) return p;
    const r = a.reward;
    if (r.credits)   p = { ...p, credits: (p.credits||0) + r.credits };
    if (r.turns)     p = { ...p, turnsLeft: (p.turnsLeft||0) + r.turns };
    if (r.maxHp)     p = { ...p, maxHp: (p.maxHp||100) + r.maxHp, hp: Math.min((p.hp||0) + r.maxHp, (p.maxHp||100) + r.maxHp) };
    if (r.maxTurns)  p = { ...p, bonusTurns: (p.bonusTurns||0) + r.maxTurns, turnsLeft: (p.turnsLeft||0) + r.maxTurns };
    if (r.critBonus) p = { ...p, bonusCrit: ((p.bonusCrit||0) + r.critBonus) };
    if (r.rep)       p = { ...p, rep: Math.min(500, Math.max(-500, (p.rep||0) + r.rep)) };
    return p;
  };

  const unlockAchievements = (p, context = {}) => {
    const newOnes = checkAchievements(p, context);
    if (newOnes.length === 0) return p;
    for (const id of newOnes) p = applyAchievementReward(p, id);
    const updated = { ...p, badges: [...(p.badges || []), ...newOnes] };
    setAchievementQueue(q => [...q, ...newOnes]);
    // Post notable achievements to grid activity
    newOnes.forEach(id => {
      const a = ACHIEVEMENTS[id];
      if (a && !a.secret) {
        postGridActivity({ type:"achievement", icon:a.icon, parts:[
          {text: p.name, color: CLASSES[p.cls]?.color, bold:true},
          {text: " earned "},
          {text: a.name, color:"#ffff55", bold:true},
        ]});
      }
    });
    return updated;
  };

  const dismissAchievement = () => setAchievementQueue(q => q.slice(1));

  const renderAchievementToast = () => {
    if (achievementQueue.length === 0) return null;
    const id = achievementQueue[0];
    const a = ACHIEVEMENTS[id];
    if (!a) { dismissAchievement(); return null; }
    const r = a.reward || {};
    const rewardText = [
      r.credits  ? `+₡${r.credits}` : '',
      r.turns    ? `+${r.turns} turn${r.turns>1?'s':''}` : '',
      r.maxTurns ? `+${r.maxTurns} max turns` : '',
      r.maxHp    ? `+${r.maxHp} max HP` : '',
      r.critBonus? `+${Math.round(r.critBonus*100)}% crit` : '',
      r.rep > 0  ? `+${r.rep} rep` : '',
      r.rep < 0  ? `${r.rep} rep` : '',
    ].filter(Boolean).join(' · ');

    return (
      <div className="achievement-toast" onClick={dismissAchievement}>
        <div className="achievement-header">
          ◈ ACHIEVEMENT UNLOCKED {achievementQueue.length > 1 ? `(+${achievementQueue.length-1} more)` : ""}
        </div>
        <div className="achievement-body">
          <div className="achievement-icon">{a.icon}</div>
          <div>
            <div className="achievement-name">{a.name}</div>
            <div className="achievement-desc">{a.desc}</div>
            {rewardText && <div style={{fontSize:11,color:"#ffff55",marginTop:4}}>{rewardText}</div>}
          </div>
        </div>
        <div className="achievement-dismiss">[ CLICK TO DISMISS ]</div>
      </div>
    );
  };

  // ── GRID RATING SYSTEM ───────────────────────────────────────────────────────
  const applyRatingEvent = (p, event) => {
    switch (event) {
      case "kill":          p = updateRating(p, "threat", 2); p = updateRating(p, "entertainment", 1); break;
      case "boss_kill":     p = updateRating(p, "threat", 8); p = updateRating(p, "entertainment", 6); p = updateRating(p, "survival", 4); p = updateRep(p, 20); break;
      case "pvp_win":       p = updateRating(p, "threat", 5); p = updateRating(p, "entertainment", 4); p = updateRep(p, -10); break;
      case "pvp_loss":      p = updateRating(p, "survival", 2); p = updateRating(p, "entertainment", 1); break;
      case "low_hp_win":    p = updateRating(p, "survival", 6); p = updateRating(p, "entertainment", 8); p = updateRep(p, 5); break;
      case "dungeon_clear": p = updateRating(p, "threat", 6); p = updateRating(p, "survival", 5); p = updateRating(p, "entertainment", 5); p = updateRep(p, 10); break;
      case "dungeon_fail":  p = updateRating(p, "survival", -3); break;
      case "quest_claim":   p = updateRating(p, "entertainment", 2); p = updateRep(p, 5); break;
      case "mercy":         p = updateRating(p, "entertainment", 4); p = updateRep(p, 15); break;
      case "bully":         p = updateRating(p, "threat", 2); p = updateRep(p, -15); break;
      case "profile_msg":   p = updateRating(p, "entertainment", 1); p = updateRep(p, 5); break;
      case "streak":        p = updateRating(p, "survival", 2); p = updateRep(p, 5); break;
      default: break;
    }
    // Check for new sponsor (level 9+)
    if (p.level >= 9) {
      const newSponsor = getActiveSponsor(p);
      const oldSponsorId = p.sponsor;
      if (newSponsor && newSponsor.id !== oldSponsorId) {
        p = { ...p, sponsor: newSponsor.id };
        setTimeout(() => {
          setTransmission({
            color: newSponsor.color,
            title: `INCOMING: ${newSponsor.name}`,
            body: `${newSponsor.tagline}\n\nWe've been watching your activity on the grid, runner. Your metrics caught our attention.\n\nEffective immediately, ${newSponsor.name} is backing your operation.\n\nDon't embarrass us.`,
            type: "sponsor",
            sponsorId: newSponsor.id,
          });
        }, 1500);
      }
    }
    // Check for random intervention (level 10+, 5% chance)
    if (p.level >= 10 && Math.random() < 0.05 && !p.interventionPending) {
      p = { ...p, interventionPending: generateIntervention(p) };
    }
    return p;
  };

  const generateIntervention = (p) => {
    const audience = calcAudienceSize(p);
    const rep = p.rep || 0;
    const r = p.gridRating || { entertainment: 0, threat: 0, survival: 0 };

    if (rep > 100 && audience > 300) {
      // Good interventions
      const good = [
        { type: "care_package", credits: 150, msg: "An anonymous benefactor has noticed your run. ₡150 deposited. Keep it up, runner." },
        { type: "free_intel", msg: "A fan intercepted CORP-SEC chatter. Your next enemy is running reduced ICE today." },
        { type: "rep_boost", rep: 20, msg: "The underground is talking about you. Your reputation grows." },
      ];
      return good[Math.floor(Math.random() * good.length)];
    } else if (rep < -100 && r.threat > 40) {
      // Bad interventions — corps come for you
      const bad = [
        { type: "enforcer", msg: "CORP-SEC has flagged your account. Expect a special welcoming committee on your next run." },
        { type: "bounty_placed", credits: -100, msg: "A corp just paid to put a bounty on your head. Someone's coming for you." },
      ];
      return bad[Math.floor(Math.random() * bad.length)];
    } else if (r.entertainment > 60) {
      // Pure entertainment interventions
      const neutral = [
        { type: "care_package", credits: 75, msg: "Someone in the audience liked your last run. ₡75 appeared in your wallet." },
        { type: "lyra_comped", msg: "Lyra says your next drink is on the house. You've been entertaining the grid." },
      ];
      return neutral[Math.floor(Math.random() * neutral.length)];
    }
    return null;
  };

  const applyIntervention = (p) => {
    const iv = p.interventionPending;
    if (!iv) return p;
    p = { ...p, interventionPending: null };
    if (iv.credits > 0) p = { ...p, credits: p.credits + iv.credits };
    if (iv.credits < 0) p = { ...p, credits: Math.max(0, p.credits + iv.credits) };
    if (iv.rep) p = updateRep(p, iv.rep);
    return p;
  };

  const checkAndShowIntervention = (p) => {
    if (!p.interventionPending) return p;
    const iv = p.interventionPending;
    const p2 = applyIntervention(p);
    // Show as transmission
    setTimeout(() => {
      setTransmission({
        color: iv.type === "enforcer" || iv.type === "bounty_placed" ? "#ff5555" : "#55ffff",
        title: iv.type === "enforcer" ? "WARNING: CORP-SEC ALERT"
          : iv.type === "bounty_placed" ? "WARNING: BOUNTY PLACED"
          : iv.type === "care_package" ? "TRANSMISSION: ANONYMOUS"
          : iv.type === "lyra_comped" ? "MESSAGE: NEON REFUGE"
          : "TRANSMISSION: GRID",
        body: iv.msg,
        type: "intervention",
      });
    }, 800);
    return p2;
  };

  // ── THE GHOST COLLECTIVE ─────────────────────────────────────────────────────
  const checkCollective = async (p) => {
    if (p.inCollective) return p; // already in
    if (checkCollectiveEligibility(p)) {
      setCollectiveEligible(true);
    }
    return p;
  };

  const handleJoinCollective = async () => {
    if (!checkCollectiveEligibility(player)) return;
    const cycle = getCurrentCycle();
    let p = { ...player, inCollective: true, collectiveCycle: cycle.cycle };
    await joinCollective(p);
    save(p);
    setCollectiveEligible(false);
    // Send induction transmission
    setTransmission({
      color: "#ffffff",
      title: "UNKNOWN SENDER // ENCRYPTED",
      body: `You found us.\n\n${cycle.inductionLine}\n\nThe Collective doesn't recruit. It recognizes.\n\nDon't tell anyone how you got here.\n\nThe ◬ is yours now.`,
      type: "collective",
    });
    // Post system message — cryptic, gives nothing away
    postSystemMessage("A signal was detected on an unregistered frequency.");
  };

  const handleCollectiveChat = async () => {
    const text = collectiveChatInput.trim();
    if (!text || collectiveChatLoading || !player.inCollective) return;
    setCollectiveChatLoading(true);
    setCollectiveChatInput("");
    try {
      const msgs = await postCollectiveChat(player, text);
      setCollectiveChat(msgs);
    } catch {}
    setCollectiveChatLoading(false);
  };

  const fetchCollectiveChat = async () => {
    if (!player?.inCollective) return;
    setCollectiveChatLoading(true);
    try { setCollectiveChat(await loadCollectiveChat()); } catch {}
    setCollectiveChatLoading(false);
  };

  // Inject collective clues into existing NPC interactions
  const getStaticClueInjection = () => {
    const cycle = getCurrentCycle();
    // Only show to players above level 3 who aren't already members
    if (player && player.level >= 3 && !player.inCollective && Math.random() < 0.3) {
      return cycle.staticClue;
    }
    return null;
  };

  // Check eligibility whenever player state changes
  useEffect(() => {
    if (player && !player.inCollective) {
      setCollectiveEligible(checkCollectiveEligibility(player));
    }
  }, [player?.level, player?.rep, player?.pvpWins, player?.loginStreak,
      player?.bossDefeated, player?.dungeonsCleared?.length, player?.kills,
      player?.carePackagesSent]);

  // ── PLAYER PROFILES ──────────────────────────────────────────────────────────
  const viewProfile = async (name, cls) => {
    if (name === player.name && cls === player.cls) {
      // Viewing own profile — use live data
      setProfileTarget({ name, cls, badges: [] });
      setProfileData({
        name: player.name, cls: player.cls, level: player.level,
        kills: player.kills, pvpWins: player.pvpWins||0, pvpLosses: player.pvpLosses||0,
        bossDefeated: player.bossDefeated||false, factionId: player.factionId,
        factionXP: player.factionXP||0, loginStreak: player.loginStreak||0,
        longestStreak: player.longestStreak||0, dungeonTitles: player.dungeonTitles||[],
        badges: player.badges||[], perks: (player.perks||[]).length, credits: player.credits,
      });
      setProfileMsgs(await loadProfileMessages(name, cls));
      setProfileLyra("");
      setProfileMsgInput("");
      return;
    }
    setProfileLoading(true);
    setProfileTarget({ name, cls, badges: [] });
    setProfileData(null);
    setProfileMsgs([]);
    setProfileLyra("");
    setProfileMsgInput("");
    const [data, msgs] = await Promise.all([
      loadProfileData(name, cls),
      loadProfileMessages(name, cls),
    ]);
    setProfileData(data);
    setProfileMsgs(msgs);
    setProfileLoading(false);
    // Update profileTarget with badges from loaded data
    if (data?.badges) setProfileTarget(t => t ? { ...t, badges: data.badges } : t);
    // Get Lyra's read on this runner
    if (data) {
      const prompt = `Lyra the chrome-armed bartender gives a one-line character read on a runner named ${name} (${CLASSES[cls]?.name||cls}, Rank ${data.level}, ${data.kills} kills, ${data.bossDefeated?"defeated the Megacorp AI":"hasn't cracked the mainframe yet"}, ${data.pvpWins||0} PvP wins). Sharp, witty, one sentence. No quotes around it.`;
      getNarration(prompt).then(t => setProfileLyra(t)).catch(() => {});
    }
  };

  const closeProfile = () => {
    setProfileTarget(null);
    setProfileData(null);
    setProfileMsgs([]);
    setProfileLyra("");
  };

  const handlePostProfileMsg = async () => {
    if (!profileMsgInput.trim() || !profileTarget) return;
    const updated = await postProfileMessage(profileTarget.name, profileTarget.cls, player, profileMsgInput.trim());
    setProfileMsgs(updated);
    setProfileMsgInput("");
  };

  // ── SKILL TREE ───────────────────────────────────────────────────────────────
  const handlePickPerk = (perk) => {
    if ((player.perkPoints || 0) <= 0) return;
    if ((player.perks || []).includes(perk.id)) return;
    let p = { ...player, perks: [...(player.perks || []), perk.id], perkPoints: (player.perkPoints || 0) - 1 };
    p = perk.apply(p);
    save(p);
    if ((p.perkPoints || 0) === 0) setShowPerkModal(false);
  };

  // ── PVP ─────────────────────────────────────────────────────────────────────
  const refreshRunners = (p) => {
    const runners = generateRunners(p.level);
    runners.forEach(r => { if ((p.bounties || []).includes(r.handle)) r.isBounty = true; });
    const updated = { ...p, runners };
    save(updated);
    return updated;
  };

  const handleAttackRunner = async (runner) => {
    if (runner.safeMode) return;
    setPvpTarget(runner); setPvpLog([]); setPvpOutcome(null); setPvpLoot(0);
    setScreen("pvp");
    const isBounty = (player.bounties || []).includes(runner.handle);
    await narrate(`${player.name} locks onto ${runner.handle}'s signal. ${runner.taunt} ${isBounty ? "This one has a bounty — settle the score." : ""} Describe the ambush in 2 sentences.`);
  };

  const simulatePvpCombat = (attacker, defender) => {
    let aHp = attacker.hp, dHp = defender.hp;
    const log = [];
    let aStatuses = [], dStatuses = [];
    const tick = (arr) => arr.map(s => ({ ...s, turns: s.turns - 1 })).filter(s => s.turns > 0);
    const getBurn = (arr) => { const b = arr.find(s => s.type === "burn"); return b ? b.value : 0; };
    const getTrace = (arr) => { const t = arr.find(s => s.type === "traced"); return t ? t.value : 0; };
    const getOverload = (arr) => { const o = arr.find(s => s.type === "overloaded"); return o ? o.value : 0; };

    for (let round = 1; round <= 20 && aHp > 0 && dHp > 0; round++) {
      const aAtk = Math.max(1, attacker.atk - getOverload(aStatuses));
      const dDef = Math.max(0, defender.def - getTrace(dStatuses));
      const aCrit = Math.random() < (CLASSES[attacker.cls]?.critChance || 0.15);
      const aDmg = Math.max(1, aAtk - dDef + Math.floor(Math.random() * 4) - 1) * (aCrit ? 2 : 1);
      dHp -= aDmg;
      log.push({ type: aCrit ? "crit" : "hit", text: `[${round}] ${attacker.name||attacker.handle} hits for ${aDmg}${aCrit?" CRIT":""}` });
      if (aCrit && attacker.cls === "bruteforcer") dStatuses = [...dStatuses.filter(s=>s.type!=="burn"), {type:"burn",turns:2,value:6}];
      const dBurn = getBurn(dStatuses); if (dBurn > 0) { dHp -= dBurn; log.push({type:"burn",text:`[BURN] ${defender.handle||"target"} −${dBurn}`}); }
      dStatuses = tick(dStatuses);
      if (dHp <= 0) break;

      const dAtk = Math.max(1, defender.atk - getOverload(dStatuses));
      const aDef = Math.max(0, attacker.def - getTrace(aStatuses));
      const dCrit = Math.random() < (CLASSES[defender.cls]?.critChance || 0.15);
      const dDmg = Math.max(1, dAtk - aDef + Math.floor(Math.random() * 4) - 1) * (dCrit ? 2 : 1);
      aHp -= dDmg;
      log.push({ type: dCrit ? "crit" : "dmg", text: `[${round}] ${defender.handle||"target"} hits back for ${dDmg}${dCrit?" CRIT":""}` });
      const aBurn = getBurn(aStatuses); if (aBurn > 0) { aHp -= aBurn; log.push({type:"burn",text:`[BURN] You −${aBurn}`}); }
      aStatuses = tick(aStatuses);
    }
    return { won: dHp <= 0, log, finalAHp: Math.max(0, aHp) };
  };

  const handlePvpFight = async () => {
    if (!pvpTarget) return;
    const isBounty = (player.bounties || []).includes(pvpTarget.handle);
    const { won, log: fightLog, finalAHp } = simulatePvpCombat(
      { ...player, atk: calcAtk(player), def: calcDef(player) },
      pvpTarget
    );
    let p = { ...player };
    const entries = [...fightLog];

    if (won) {
      const base = Math.floor(pvpTarget.credits * PVP_STEAL_PCT);
      const loot = isBounty ? Math.floor(base * PVP_BOUNTY_BONUS) : base;
      const xpGain = 15 + pvpTarget.level * 10;
      p = { ...p, credits: p.credits + loot, xp: p.xp + xpGain, pvpWins: (p.pvpWins||0)+1, hp: finalAHp, turnsLeft: Math.max(0, p.turnsLeft-1) };
      p.bounties = (p.bounties||[]).filter(b => b !== pvpTarget.handle);
      p.runners = (p.runners||[]).map(r => r.id === pvpTarget.id ? {...r, credits: Math.max(0, r.credits-loot), hp: Math.max(1, r.hp-40)} : r);
      entries.push({ type:"sys", text:`[WIN] Looted ₡${loot} +${xpGain} XP from ${pvpTarget.handle}` });
      while (p.xp >= XP_PER_LEVEL(p.level)) { p.xp -= XP_PER_LEVEL(p.level); p.level++; p.maxHp+=15; p.hp=p.maxHp; p.atk+=2; p.def++; }
      // Quest tracking
      p = trackQuest(p, "pvpWins", 1);
      p = trackQuest(p, "pvpAttempts", 1);
      if (isBounty) p = trackQuest(p, "bountiesCollected", 1);
      // Faction XP
      if (p.factionId) { p.factionXP = (p.factionXP||0) + FXP_TABLE.pvpWin; contributeFactionXP(p.factionId, FXP_TABLE.pvpWin).then(d => { if (d) setFactionData(d); }); }
      p = applyRatingEvent(p, "pvp_win");
      if (pvpTarget.level < p.level - 4) p = applyRatingEvent(p, "bully");
      p = unlockAchievements(p, {
        punchedDown: pvpTarget.level < p.level - 4,
        punchedUp: pvpTarget.level > p.level + 4,
        raidedPoor: (pvpTarget.credits||0) < 100,
      });
      save(p); setPvpLoot(loot); setPvpOutcome("win"); setPvpLog(entries);
      // Log this attack against the defender for their offline log
      logOfflineAttack(pvpTarget.handle, pvpTarget.cls, {
        attackerName: player.name,
        attackerCls: player.cls,
        attackerLevel: player.level,
        creditsStolen: loot,
        won: true,
        isBounty,
        ts: Date.now(),
      });
      await narrate(`${p.name} flatlined ${pvpTarget.handle} and looted ₡${loot}.${isBounty?" Bounty collected.":""} 2 brutal sentences.`);
    } else {
      const credLoss = Math.floor(p.credits * 0.12);
      p = { ...p, credits: Math.max(0, p.credits-credLoss), hp: Math.max(1, finalAHp), pvpLosses: (p.pvpLosses||0)+1, turnsLeft: Math.max(0, p.turnsLeft-1) };
      if (!(p.bounties||[]).includes(pvpTarget.handle)) p.bounties = [...(p.bounties||[]), pvpTarget.handle];
      entries.push({ type:"dmg", text:`[LOSS] ${pvpTarget.handle} looted ₡${credLoss} — bounty placed` });
      p = trackQuest(p, "pvpAttempts", 1);
      p = applyRatingEvent(p, "pvp_loss");
      p = checkAndShowIntervention(p);
      save(p); setPvpOutcome("lose"); setPvpLog(entries);
      // Log failed attempt against defender
      logOfflineAttack(pvpTarget.handle, pvpTarget.cls, {
        attackerName: player.name,
        attackerCls: player.cls,
        attackerLevel: player.level,
        creditsStolen: 0,
        won: false,
        ts: Date.now(),
      });
      await narrate(`${p.name} got flatlined by ${pvpTarget.handle} and lost ₡${credLoss}. A bounty is now on ${pvpTarget.handle}. 2 gritty sentences.`);
    }
  };

  // ── REFUGE: LYRA ────────────────────────────────────────────────────────────
  const handleLyraBuy = async (drink) => {
    if (player.credits < drink.price) { await npcSay("lyra", `Lyra glances at your credit balance and smirks. Tell ${player.name} they're broke in one sharp line.`); return; }
    let p = { ...player, credits: player.credits - drink.price };
    if (drink.buff.stat === "hp") {
      p.hp = Math.min(p.hp + drink.buff.val, p.maxHp);
    } else {
      p.nextFightBuff = drink.buff;
    }
    save(p);
    await npcSay("lyra", `Lyra slides ${player.name} a ${drink.name}. ${drink.desc}. Give a one-line quip as she pours it.`);
  };

  const handleLyraPropose = async () => {
    if (lyraMarriage) return;
    if ((player.lyraFlirtCount||0) < 30) return;
    if ((player.rep||0) < 200) {
      await npcSay("lyra", `Lyra looks at ${player.name} for a long moment. "You're not ready. Come back when the grid respects you."`);
      return;
    }
    let p = { ...player, lyraMarried: true };
    p = unlockAchievements(p);
    save(p);
    await setLyraMarriageData(player.name, player.cls);
    setLyraMarriage({ name: player.name, cls: player.cls, ts: Date.now() });
    await npcSay("lyra", `${player.name} proposes to Lyra. After everything — every night, every secret — she says yes. 3 sentences. Make it earned.`);
    postSystemMessage(`◈ ${player.name} and LYRA are getting married. The Neon Refuge will never be the same.`);
  };

  const handleLyraFlirt = async () => {
    if (lyraMarriage) { await npcSay("lyra", `GRUNT stares blankly. "She's taken." One word.`); return; }
    const today = new Date().toDateString();
    if ((player.lastFlirtDate || "") === today) {
      await npcSay("lyra", `Lyra doesn't even look up. "I'm busy. Try again tomorrow." She means it.`);
      return;
    }
    const count = player.lyraFlirtCount || 0;
    const p = { ...player, lyraFlirtCount: count + 1 };
    save(p);
    const stage = count === 0 ? "first time flirting, she's amused but guarded"
      : count === 1 ? "second time, she's warming up slightly, gives a real smile"
      : count === 2 ? "third time, she leans in and says something genuinely flirtatious back"
      : "they've been flirting for a while, she's fond of them but keeps it playful";
    // Inject collective clue for eligible players at the right moment
    const cycle = getCurrentCycle();
    const addClue = !player.inCollective && collectiveEligible && count >= 1;
    const clueAdd = addClue ? ` At the end, she adds quietly: "${cycle.lyraClue}"` : "";
    await npcSay("lyra", `${player.name} flirts with Lyra the chrome-armed bartender. This is the ${stage}. Write her response in 2 sentences — sharp, witty, never a pushover.${clueAdd}`);
  };

  // ── REFUGE: STATIC ───────────────────────────────────────────────────────────
  const handleStaticRumor = async () => {
    if (player.credits < 20) { await npcSay("static", `Static needs ₡20 for the intel. They glitch and say ${player.name} is short. One fragmented line.`); return; }
    const nextEnemy = getEnemyForLevel(player.level);
    const p = { ...player, credits: player.credits - 20, scoutedEnemy: nextEnemy.name };
    save(p);
    // 30% chance to inject a collective clue for eligible non-members
    const clueInjection = getStaticClueInjection();
    if (clueInjection && !player.inCollective && player.level >= 3) {
      await npcSay("static", `Static the glitched AI DJ whispers to ${player.name}: ${clueInjection} Then adds intel about a ${nextEnemy.name} on the grid. Keep the clue cryptic and fragmented.`);
    } else {
      await npcSay("static", `Static the glitched AI DJ whispers intel to ${player.name} about a ${nextEnemy.name} lurking on the grid. Describe this in 2 fragmented, cryptic sentences — music metaphors, glitchy speech.`);
    }
  };

  const handleStaticChat = async () => {
    await npcSay("static", `Static the glitched AI DJ tells ${player.name} a cryptic rumor about the grid or the Megacorp tonight. 2 sentences, fragmented, atmospheric, like a corrupted broadcast.`);
  };

  // ── REFUGE: SAFE MODE ────────────────────────────────────────────────────────
  const handleSafeMode = async () => {
    if (player.credits < SAFEMODE_COST) { setNarration("// INSUFFICIENT CREDITS — The Neon Refuge doesn't run on goodwill."); return; }
    const until = new Date(Date.now() + SAFEMODE_HOURS * 3600 * 1000).toISOString();
    const p = { ...player, credits: player.credits - SAFEMODE_COST, hp: player.maxHp, statusEffects: [], safeModeUntil: until };
    save(p);
    await narrate(`${player.name} pays ₡${SAFEMODE_COST} and goes dark in the Neon Refuge. Full systems restored, signal masked, untouchable for 24 hours. Describe the moment of going off-grid in 2 sentences.`);
  };

  // ── SHOP ────────────────────────────────────────────────────────────────────
  const handleBuy = async (gear) => {
    if (player.credits < gear.price) { setNarration("// INSUFFICIENT CREDITS"); return; }
    let p = { ...player, credits: player.credits - gear.price, gear: [...player.gear, gear.id] };
    p = trackQuest(p, "gearBought", 1);
    save(p);
    await narrate(`${player.name} picks up the ${gear.name} from the black market. 1 sentence.`);
  };

  const handleReset = () => {
    localStorage.removeItem("netrunner_v3");
    setPlayer(null); setScreen("title"); setNarration("");
    setAuthHandle(""); setAuthPassword(""); setAuthConfirm(""); setAuthError("");
  };

  // ─── SCREENS ──────────────────────────────────────────────────────────────

  const renderTitle = () => (
    <div className="title-screen">

      {/* SIGTERM ASCII Logo */}
      <pre style={{color:"#55ff55",fontSize:"clamp(5px,0.95vw,10px)",lineHeight:1.3,marginBottom:12,textAlign:"center"}}>{`██████  ██▓  ▄████ ▄▄▄█████▓▓█████  ██▀███   ███▄ ▄███▓
▒██    ▒ ▓██▒ ██▒ ▀█▒▓  ██▒ ▓▒▓██   ▀ ▓██ ▒ ██▒▓██▒▀█▀ ██▒
░ ▓██▄   ▒██▒▒██░▄▄▄░▒ ▓██░ ▒░▒███   ▓██ ░▄█ ▒▓██    ▓██░
  ▒   ██▒░██░░▓██  ██▓░ ▓██▓ ░ ▒▓██  ▄ ▒██▀▀█▄  ▒██    ▒██ 
▒██████▒▒░██░░▒▓███▀▒  ▒██▒ ░ ░▒████▒░███▓ ▒██▒▒██▒   ░██▒
▒ ▒▓▒ ▒ ░░▓   ░▒   ▒   ▒ ░░░   ░░ ▒░ ░░░▒ ░░ ▒▓ ░▒▓░░▒ ▒░   ░  ░
░ ░▒  ░ ░ ▒ ░  ░   ░     ░     ░ ░  ░  ░▒ ░ ▒░░  ░      ░
░  ░  ░   ▒ ░░▒ ░   ░   ░         ░     ░░   ░ ░      ░   
      ░   ░        ░             ░  ░   ░            ░`}</pre>

      {/* Tagline */}
      <div style={{color:"#55ffff",fontSize:13,letterSpacing:".2em",marginBottom:24}}>
        THEY BUILT THE GRID. WE OWN IT.
      </div>

      {/* Separator */}
      <div style={{color:"#1a1a1a",marginBottom:20}}>{"━".repeat(52)}</div>

      {/* World intro */}
      <div style={{color:"#666",fontSize:13,lineHeight:2.2,marginBottom:20}}>
        <div>The Penley-Morrison Corporation controls</div>
        <div><span style={{color:"#ff5555",fontWeight:700,fontSize:15}}>94%</span> of global network infrastructure.</div>
        <div style={{marginTop:6}}>The other <span style={{color:"#55ff55",fontWeight:700,fontSize:15}}>6%</span> is ours.</div>
      </div>

      {/* Separator */}
      <div style={{color:"#1a1a1a",marginBottom:20}}>{"━".repeat(52)}</div>

      {/* Value prop */}
      <div style={{color:"#444",fontSize:11,letterSpacing:".15em",marginBottom:28}}>
        FREE &nbsp;·&nbsp; BROWSER BASED &nbsp;·&nbsp; REAL PLAYERS &nbsp;·&nbsp; 10 MINUTES A DAY
      </div>

      {/* Buttons */}
      <div style={{display:"flex",gap:16,justifyContent:"center",marginBottom:28}}>
        <button className="btn" style={{
          fontSize:13,padding:"12px 32px",letterSpacing:".15em",
          borderColor:"#55ffff",color:"#55ffff",minWidth:180,
        }} onClick={() => { setAuthMode("register"); setAuthError(""); setScreen("auth"); }}>
          NEW RUNNER
        </button>
        <button className="btn" style={{
          fontSize:13,padding:"12px 32px",letterSpacing:".15em",
          borderColor:"#55ff55",color:"#55ff55",minWidth:180,
        }} onClick={() => { setAuthMode("login"); setAuthError(""); setScreen("auth"); }}>
          JACK IN
        </button>
      </div>

      {/* Separator */}
      <div style={{color:"#1a1a1a",marginBottom:16}}>{"━".repeat(52)}</div>

      {/* Live stats */}
      <div style={{color:"#333",fontSize:11,letterSpacing:".12em",lineHeight:2}}>
        <span style={{color:"#444"}}>RUNNERS:</span>{" "}
        <span style={{color:"#55ff55"}}>{lbData?.length || "—"}</span>
        {" "}&nbsp;·&nbsp;{" "}
        <span style={{color:"#444"}}>SEASON:</span>{" "}
        <span style={{color:"#55ff55"}}>1</span>
        {" "}&nbsp;·&nbsp;{" "}
        <span style={{color:"#444"}}>VAULT:</span>{" "}
        <span style={{color:"#ffff55"}}>₡—</span>
      </div>

    </div>
  );

  const renderAuth = () => {
    const isLogin = authMode === "login";
    const handleSubmit = isLogin ? handleLogin : handleRegister;
    return (
      <div>
        <button className="lord-back" onClick={() => { setScreen("title"); setAuthError(""); }}>&#9666; BACK</button>
        <div className="panel auth-box">
          <div className="auth-title">
            {isLogin ? "// JACK IN — AUTHENTICATE" : "// NEW RUNNER — CREATE ACCOUNT"}
          </div>
          <div className="auth-sub">
            {isLogin
              ? "Enter your handle and password to access the grid."
              : "Choose a handle and password. Your handle is how other runners know you."
            }
          </div>

          {authError && <div className="auth-error">{authError}</div>}

          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div>
              <div className="dim" style={{fontSize:12,marginBottom:4}}>HANDLE</div>
              <input className="input" placeholder="e.g. VASH, CIPHER, NULL_PTR..."
                value={authHandle} maxLength={20}
                onChange={e => setAuthHandle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !isLogin && document.getElementById("auth-pw")?.focus()}
                autoFocus />
            </div>
            <div>
              <div className="dim" style={{fontSize:12,marginBottom:4}}>PASSWORD</div>
              <input id="auth-pw" className="input" type="password" placeholder="Min 6 characters..."
                value={authPassword}
                onChange={e => setAuthPassword(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    if (!isLogin) document.getElementById("auth-confirm")?.focus();
                    else handleSubmit();
                  }
                }} />
            </div>
            {!isLogin && (
              <div>
                <div className="dim" style={{fontSize:12,marginBottom:4}}>CONFIRM PASSWORD</div>
                <input id="auth-confirm" className="input" type="password" placeholder="Repeat password..."
                  value={authConfirm}
                  onChange={e => setAuthConfirm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSubmit()} />
              </div>
            )}
          </div>

          {!isLogin && (
            <div style={{marginTop:14}}>
              <div className="dim" style={{fontSize:12,marginBottom:8}}>CHOOSE YOUR CLASS</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {Object.entries(CLASSES).map(([key, cls]) => (
                  <button key={key} className="btn" style={{
                    padding:"10px 12px", fontSize:13, textAlign:"left",
                    borderColor: selectedClass === key ? cls.color : "#333",
                    color: selectedClass === key ? cls.color : "#666",
                    background: selectedClass === key ? `${cls.color}11` : "transparent",
                    display:"grid", gridTemplateColumns:"48px 1fr",
                    gap:10, alignItems:"start",
                  }} onClick={() => setSelectedClass(key)}>
                    <span style={{fontSize:15,fontWeight:700,textAlign:"center",color:cls.color}}>{cls.icon}</span>
                    <span>
                      <span style={{fontWeight:700,color: selectedClass === key ? cls.color : "#ccc"}}>{cls.name}</span>
                      <span style={{display:"block",fontSize:12,color:"#777",marginTop:3,fontWeight:400,letterSpacing:".02em"}}>{cls.desc}</span>
                      <span style={{display:"block",fontSize:11,color:"#555",marginTop:2}}>
                        HP {cls.hp} · ATK {cls.atk} · DEF {cls.def} · CRIT {Math.round(cls.critChance*100)}%
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button className="btn btn-full" style={{
            marginTop:16, padding:"10px", fontSize:14, letterSpacing:".1em",
            borderColor: isLogin ? "#55ff55" : "#55ffff",
            color: isLogin ? "#55ff55" : "#55ffff",
          }} onClick={handleSubmit} disabled={authLoading}>
            {authLoading ? "// Connecting..." : isLogin ? "◈ JACK IN" : "◈ INITIALIZE RUNNER"}
          </button>

          <div className="auth-switch">
            {isLogin
              ? <>No account? <span onClick={() => { setAuthMode("register"); setAuthError(""); }}>Create a new runner</span></>
              : <>Already have a runner? <span onClick={() => { setAuthMode("login"); setAuthError(""); }}>Jack in</span></>
            }
          </div>
        </div>
      </div>
    );
  };

  const renderCreate = () => (
    <div>
      <div className="panel">
        <div className="location-header">CREATE YOUR RUNNER</div>
        <div className="dim mb-8">Choose a handle — this is how other runners will know you.</div>
        <input className="input" placeholder="Enter your handle (e.g. VASH, CIPHER, NULL_PTR)..."
          value={nameInput} autoFocus
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && nameInput.trim() && handleCreate()} />      </div>
      <div className="panel">
        <div className="location-header">SELECT YOUR CLASS <span style={{color:"#888888",fontSize:11}}>· 1/2/3 TO SELECT</span></div>
        <div className="dim mb-8">Your class shapes your playstyle. You can't change it later.</div>
        <div className="class-grid">
          {Object.entries(CLASSES).map(([key, cls], idx) => (
            <div key={key} className={`class-row ${selectedClass === key ? "selected" : ""}`}
              onClick={() => setSelectedClass(key)}>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:13,color:"#888888",marginBottom:4}}>[{idx+1}]</div>
                <div className="class-row-icon" style={{color:cls.color}}>{cls.icon}</div>
                <div style={{fontSize:13,color:cls.color,fontWeight:700,marginTop:4}}>{cls.name}</div>
              </div>
              <div>
                <div style={{fontSize:14,color:"#cccccc",lineHeight:1.5}}>{cls.desc}</div>
                <div className="class-row-stats">
                  HP {cls.hp} · ATK {cls.atk} · DEF {cls.def} · CRIT {Math.round(cls.critChance*100)}%
                </div>
                <div className="class-row-ability">
                  <span style={{color:cls.color}}>⚡ {cls.ability.name}</span><br/>
                  <span>{cls.ability.desc}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <button className="btn btn-full" style={{fontSize:13,padding:"10px"}}
        onClick={handleCreate} disabled={!nameInput.trim()}>
        JACK IN AS {nameInput.trim() ? nameInput.toUpperCase() : "..."}
      </button>
    </div>
  );

  const renderHub = () => {
    const cls = CLASSES[player.cls];
    const safeActive = isSafeModeActive(player);
    const questAlert = (player.quests||[]).some(q=>!q.claimed&&getQuestDef(q.id)&&q.progress>=(getQuestDef(q.id)?.goal||99));
    const perkAlert = (player.perkPoints||0) > 0;
    const hasInventory = (player.inventory||[]).length > 0;

    // ── MAIN MENU (LORD-style) ──────────────────────────────────────────────
    if (!tab) return (
      <div className={glitch ? "glitch" : ""}>
        {/* Status bar */}
        <div className="panel">
          <div className="status-bar mb-8">
            <div>
              <div className="status-name clickable-name" style={{color:cls.color}}
                onClick={() => viewProfile(player.name, player.cls)}>
                {cls.icon} {player.name}
              </div>
              <div style={{marginTop:4}}>
                <span className="badge badge-green">RANK {player.level}</span>
                {player.factionId && <span style={{fontSize:12,color:FACTIONS[player.factionId]?.color,marginLeft:8}}>{FACTIONS[player.factionId]?.icon} {FACTIONS[player.factionId]?.name}</span>}
              </div>
            </div>
            <div className="status-right">
              <div className="status-credits">₡{player.credits.toLocaleString()}</div>
              <div className={`status-turns ${player.turnsLeft <= 2 ? "low" : ""}`}>
                {player.turnsLeft} turns{player.turnsLeft === 0 ? " — EXHAUSTED" : player.turnsLeft <= 2 ? " — LOW" : ""}
              </div>
              <div className="dim" style={{marginTop:2}}>🔥 {player.loginStreak||0} day streak</div>
            </div>
          </div>
          <StatBar label="INTEGRITY" value={player.hp} max={player.maxHp} type={player.hp < player.maxHp * 0.25 ? "hp critical" : "hp"} />
          {player.hp < player.maxHp * 0.25 && <div style={{fontSize:12,color:"#ff5555",marginTop:4}}>⚠ CRITICAL — Visit the Neon Refuge to repair</div>}
          <StatusChips statuses={player.statusEffects} buff={player.nextFightBuff} />
          {player.scoutedEnemy && <div style={{fontSize:13,color:"#55ffff",marginTop:6}}>◈ Intel: watch for <strong>{player.scoutedEnemy}</strong></div>}
        </div>

        {safeActive && (
          <div className="safemode-banner" style={{marginBottom:10}}>
            🛡 SAFE MODE ACTIVE · {safeModeRemaining(player)} remaining
          </div>
        )}

        {/* LORD-style location menu */}
        <div className="panel">
          <div className="location-header">WHERE DO YOU WANT TO GO?</div>
          <div className="lord-menu">
            <button className="lord-item" onClick={() => setTab("grid")}>
              <span className="lord-key">G</span>
              <span className="lord-name">The Grid</span>
              <span className="lord-hint">{player.turnsLeft > 0 ? `${player.turnsLeft} runs left` : <span style={{color:"#ff5555"}}>no turns left</span>}</span>
            </button>
            <button className="lord-item" onClick={() => setTab("dungeons")}>
              <span className="lord-key">D</span>
              <span className="lord-name">OffOps</span>
              <span className="lord-hint">offensive ops · {DUNGEON_TURN_COST} turns each</span>
            </button>
            <button className="lord-item" onClick={() => setTab("quests")}>
              <span className="lord-key">Q</span>
              <span className="lord-name">
                Daily Missions
                {questAlert && <span className="lord-alert" />}
              </span>
              <span className="lord-hint">{(player.quests||[]).filter(q=>q.claimed).length}/3 done</span>
            </button>
            <button className="lord-item" onClick={() => setTab("refuge")}>
              <span className="lord-key">R</span>
              <span className="lord-name">The Neon Refuge</span>
              <span className="lord-hint">bar · intel · chat</span>
            </button>
            <button className="lord-item" onClick={() => setTab("market")}>
              <span className="lord-key">M</span>
              <span className="lord-name">Black Market</span>
              <span className="lord-hint">gear · ₡{player.credits.toLocaleString()}</span>
            </button>
            <button className="lord-item" onClick={() => setTab("runner")}>
              <span className="lord-key">P</span>
              <span className="lord-name">
                Runner Profile
                {perkAlert && <span className="lord-alert" />}
              </span>
              <span className="lord-hint">
                {player.level >= 3 ? `${getRepTitle(player.rep||0).title} · stats · skills` : "stats · skills · faction"}
              </span>
            </button>
            <button className="lord-item" onClick={() => setHelpScreen("main")}>
              <span className="lord-key" style={{color:"#888888"}}>?</span>
              <span className="lord-name" style={{color:"#888888"}}>Help</span>
              <span className="lord-hint">how to play</span>
            </button>
          </div>
        </div>

        <Narration text={narration} loading={narLoading} />

        {streakModal && renderStreakModal()}
        {showPerkModal && renderPerkModal()}

        <div style={{display:"flex",gap:8,marginTop:4}}>
          <button className="btn btn-sm" style={{borderColor:"#555",color:"#888"}} onClick={() => {
            localStorage.removeItem("netrunner_v3");
            localStorage.removeItem("netrunner_token");
            setPlayer(null); setScreen("title");
            setAuthHandle(""); setAuthPassword(""); setAuthError("");
          }}>// LOG OUT</button>
          <button className="btn btn-danger btn-sm" onClick={handleReset}>// WIPE SAVE</button>
        </div>
        <div className="dim" style={{marginTop:6,textAlign:"center",fontSize:12,letterSpacing:".08em"}}>
          Use letter keys to navigate · ESC = back · A/S/F in combat · <span style={{color:"#888"}}>click screen first if keys don't work</span>
        </div>
      </div>
    );

    // ── LOCATION SCREENS ────────────────────────────────────────────────────
    const backBtn = (
      <button className="lord-back" onClick={() => {
        if (tab.startsWith("runner_")) setTab("runner");
        else if (tab.startsWith("world_")) setTab("world");
        else setTab("");
      }}>
        &#9666; BACK
      </button>
    );

    // THE GRID
    if (tab === "grid") return (
      <div>
        {backBtn}
        <button className="btn btn-sm" style={{marginBottom:8,marginLeft:8,color:"#888888",borderColor:"#333333"}} onClick={()=>setHelpScreen("grid")}>? Help</button>
        <AnsiGrid rows={HEADERS.grid} scale={1.0} />
        <div className="panel">
          <div className="location-header">THE GRID</div>
          <Narration text={narration} loading={narLoading} />
          <p className="dim mb-12" style={{lineHeight:1.7}}>
            Each dive into the grid costs 1 turn. You have <span style={{color: player.turnsLeft <= 2 ? "#ff5555" : "#55ff55"}}>{player.turnsLeft}</span> turns remaining today.
            {player.level >= 6 && !player.bossDefeated && <><br/><span style={{color:"#ff55ff"}}>⚠ The Megacorp AI has marked you for termination.</span></>}
            {player.scoutedEnemy && <><br/><span style={{color:"#55ffff"}}>◈ Static's intel: expect a <strong>{player.scoutedEnemy}</strong></span></>}
          </p>
          <button className="btn btn-full" style={{fontSize:13,padding:"10px"}}
            onClick={handleEnterGrid} disabled={player.turnsLeft <= 0 || narLoading}>
            {player.turnsLeft <= 0 ? "NO TURNS LEFT — Come back tomorrow" : `[G] DIVE IN  (${player.turnsLeft} turns left)`}
          </button>
        </div>
      </div>
    );

    // DEEP GRID RUNS (DUNGEONS)
    if (tab === "dungeons") return (
      <div>
        {backBtn}
        <button className="btn btn-sm" style={{marginBottom:8,marginLeft:8,color:"#888888",borderColor:"#333333"}} onClick={()=>setHelpScreen("dungeons")}>? Help</button>
        <AnsiGrid rows={HEADERS.dungeon} scale={1.0} />
        <div className="panel">
          <div className="panel-title">// DEEP GRID RUNS</div>
          <div className="dim mb-12" style={{lineHeight:1.6}}>
            Multi-room crawls. HP carries between rooms. Die and lose all loot.
            Clear the boss and keep everything. Costs {DUNGEON_TURN_COST} turns to enter.
          </div>
          {DUNGEONS.map(dungeon => {
            const locked = player.level < dungeon.levelReq;
            const cleared = (player.dungeonsCleared||[]).includes(dungeon.id);
            return (
              <div key={dungeon.id} className={`dungeon-card ${locked?"locked":""} ${cleared?"cleared":""}`}
                style={{borderColor: locked ? "#333" : dungeon.color}}
                onClick={() => !locked && handleEnterDungeon(dungeon)}>
                <div className="flex-between mb-8">
                  <span className="dungeon-name" style={{color: locked?"#555":dungeon.color}}>
                    {dungeon.icon} {dungeon.name}
                    {cleared && <span style={{fontSize:11,marginLeft:8,color:dungeon.color}}>[CLEARED]</span>}
                  </span>
                  <span className="dim">{locked ? `Rank ${dungeon.levelReq}+` : `${DUNGEON_TURN_COST} turns`}</span>
                </div>
                <div className="dungeon-desc">{dungeon.desc}</div>
                <div className="dungeon-rooms">
                  {dungeon.rooms.map((r,i) => (
                    <div key={i} className={`dungeon-room-pip ${r.boss?"boss":""}`} style={{borderColor: r.boss?"#ff5555":locked?"#333":dungeon.color}}>
                      {r.boss ? "B" : i+1}
                    </div>
                  ))}
                </div>
                <div className="dim" style={{fontSize:12}}>
                  Title: <span style={{color:dungeon.color}}>[{dungeon.titleReward}]</span>
                  {" · Boss: "}{dungeon.rooms[4].bossName}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );

    // DAILY QUESTS
    if (tab === "quests") return (
      <div>
        {backBtn}
        <button className="btn btn-sm" style={{marginBottom:8,marginLeft:8,color:"#888888",borderColor:"#333333"}} onClick={()=>setHelpScreen("quests")}>? Help</button>
        <AnsiGrid rows={HEADERS.quests} scale={1.0} />
        <div className="panel">
          <div className="panel-title">// DAILY MISSIONS</div>
          {renderQuestsTab()}
        </div>
      </div>
    );

    // NEON REFUGE
    if (tab === "refuge") return (
      <div>
        {backBtn}
        <button className="btn btn-sm" style={{marginBottom:8,marginLeft:8,color:"#888888",borderColor:"#333333"}} onClick={()=>setHelpScreen("refuge")}>? Help</button>
        {renderRefuge()}
      </div>
    );

    // BLACK MARKET
    if (tab === "market") return (
      <div>
        {backBtn}
        <button className="btn btn-sm" style={{marginBottom:8,marginLeft:8,color:"#888888",borderColor:"#333333"}} onClick={()=>setHelpScreen("market")}>? Help</button>
        <AnsiGrid rows={HEADERS.market} scale={1.0} />
        <div className="panel">
          <div className="panel-title">// BLACK MARKET</div>
          {GEAR.map(gear => {
            const owned = player.gear.includes(gear.id);
            const discount = player._shopDiscount || 0;
            const price = Math.floor(gear.price * (1 - discount));
            return (
              <div key={gear.id} className={`gear-item ${owned?"owned":""}`}>
                <div className="gear-info">
                  <div className="gear-name">{gear.name}</div>
                  <div className="gear-desc">{gear.desc}</div>
                  <div className="gear-stats">+{gear.atk} ATK / +{gear.def} DEF</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div className="gear-price">₡{price}{discount>0&&<span style={{color:"#888",textDecoration:"line-through",marginLeft:4,fontSize:12}}>₡{gear.price}</span>}</div>
                  <button className="btn btn-sm mt-8" disabled={owned||player.credits<price||narLoading} onClick={()=>handleBuy({...gear,price})}>
                    {owned?"OWNED":"BUY"}
                  </button>
                </div>
              </div>
            );
          })}
          {hasInventory && (
            <>
              <div className="panel-title" style={{marginTop:14}}>// YOUR BAG</div>
              {renderInventoryTab(false)}
            </>
          )}
        </div>
      </div>
    );

    // RUNNER PROFILE
    if (tab === "runner") return (
      <div>
        {backBtn}
        <button className="btn btn-sm" style={{marginBottom:8,marginLeft:8,color:"#888888",borderColor:"#333333"}} onClick={()=>setHelpScreen("runner")}>? Help</button>
        <AnsiGrid rows={HEADERS.profile} scale={1.0} />
        {/* Stats */}
        <div className="panel">
          <div className="panel-title">// RUNNER PROFILE</div>
          <div className="flex-between mb-8">
            <div>
              <span style={{fontSize:13,color:cls.color}}>{cls.icon} {player.name}</span>
              <span className="badge badge-green" style={{marginLeft:8}}>RANK {player.level}</span>
            </div>
            <span className="credits">₡{player.credits}</span>
          </div>
          <StatBar label="INTEGRITY" value={player.hp} max={player.maxHp} type="hp" />
          <StatBar label="REP" value={player.xp} max={XP_PER_LEVEL(player.level)} type="xp" />
          <div className="dim mt-8">ATK:{calcAtk(player)} DEF:{calcDef(player)} CRIT:{Math.round(calcCrit(player)*100)}% KILLS:{player.kills}</div>
          {((player.pvpWins||0)>0||(player.pvpLosses||0)>0) && (
            <div className="pvp-record mt-8">
              PvP: <span>{player.pvpWins||0}W</span>/<span className="loss">{player.pvpLosses||0}L</span>
              {(player.bounties||[]).length>0 && <span style={{color:"#ffff55",marginLeft:8}}>⚠ {player.bounties.length} bounty</span>}
            </div>
          )}
          <StatusChips statuses={player.statusEffects} buff={player.nextFightBuff} />
          {/* Faction */}
          {player.factionId && (() => {
            const f = FACTIONS[player.factionId];
            const rank = getFactionRank(player.factionXP||0);
            return <div className="mt-8" style={{fontSize:13,color:f.color}}>{f.icon} {f.name} · {rank.name} · {player.factionXP||0} FXP</div>;
          })()}
          {/* Rep + Sponsor — unlocks progressively by level */}
          {player.level >= 3 && (() => {
            const repTitle = getRepTitle(player.rep || 0);
            const sponsor = player.sponsor ? SPONSORS[player.sponsor] : null;
            const audience = calcAudienceSize(player);
            return (
              <div className="mt-8">
                {/* Level 3+: Rep title */}
                <span style={{fontSize:13,color:repTitle.color}}>{repTitle.title}</span>
                <span className="rep-title" style={{borderColor:repTitle.color,color:repTitle.color}}>
                  {(player.rep||0) >= 0 ? "+" : ""}{player.rep||0} REP
                </span>
                {/* Level 7+: Audience */}
                {player.level >= 7 && (
                  <span className="dim" style={{marginLeft:8,fontSize:12}}>{audience.toLocaleString()} watching</span>
                )}
                {/* Level 9+: Sponsor */}
                {player.level >= 9 && sponsor && (
                  <div style={{fontSize:12,color:SPONSORS[sponsor]?.color,marginTop:3}}>
                    ◈ {SPONSORS[sponsor]?.name}
                  </div>
                )}
              </div>
            );
          })()}
          {/* Streak + badges */}
          <div className="mt-8 flex-between">
            <span className="streak-chip" onClick={() => setStreakModal({streak:player.loginStreak||0,milestone:null,streakBroken:false,longestStreak:player.longestStreak||0,view:true})}>
              🔥 {player.loginStreak||0} day streak
            </span>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}}>
              {(player.badges||[]).map(b=><span key={b} className="streak-badge">{b.replace(/_/g," ")}</span>)}
              {(player.dungeonTitles||[]).map(t=><span key={t} className="streak-badge" style={{borderColor:"#55ffff",color:"#55ffff"}}>{t}</span>)}
              {player.inCollective && <span className="collective-badge visible" title="The Ghost Collective">◬</span>}
            </div>
          </div>
          {/* Collective eligibility hint — cryptic */}
          {collectiveEligible && !player.inCollective && (
            <div className="mt-8" style={{fontSize:12,color:"#666666",fontStyle:"italic",letterSpacing:".05em"}}>
              // something is different today. check your messages.
            </div>
          )}
        </div>

        {/* Achievements */}
        {(player.badges||[]).length > 0 && (
          <div className="panel">
            <div className="panel-title">// ACHIEVEMENTS ({(player.badges||[]).length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              {(player.badges||[]).map(id => {
                const a = ACHIEVEMENTS[id];
                if (!a) return null;
                return (
                  <div key={id} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"7px 0",borderBottom:"1px solid #1a1a1a"}}>
                    <span style={{fontSize:20,flexShrink:0,lineHeight:1}}>{a.icon}</span>
                    <div>
                      <div style={{fontSize:13,color:"#ffffff",fontWeight:700}}>{a.name}</div>
                      <div style={{fontSize:12,color:"#666",lineHeight:1.6,marginTop:2}}>{a.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Grid Rating — unlocks progressively by level */}
        {player.level >= 3 && (
        <div className="panel">
          <div className="panel-title">// GRID RATING</div>
          {(() => {
            const r = player.gridRating || { entertainment: 0, threat: 0, survival: 0 };
            const repTitle = getRepTitle(player.rep || 0);
            const sponsor = player.sponsor ? SPONSORS[player.sponsor] : getActiveSponsor(player);
            const audience = calcAudienceSize(player);
            return (
              <div>
                <div className="flex-between mb-8">
                  <div>
                    <span style={{fontSize:13,color:repTitle.color,fontWeight:700}}>{repTitle.title}</span>
                    <span className="rep-title" style={{borderColor:repTitle.color,color:repTitle.color,fontSize:12}}>
                      {(player.rep||0) >= 0 ? "+" : ""}{player.rep||0} REP
                    </span>
                  </div>
                  {player.level >= 7
                    ? <span className="dim">{audience.toLocaleString()} watching</span>
                    : <span className="dim" style={{fontSize:12}}>Rank 7 unlocks audience</span>
                  }
                </div>
                <div className="dim mb-8" style={{fontSize:13,fontStyle:"italic"}}>{repTitle.desc}</div>

                {player.level >= 5 ? (
                  [{label:"ENTERTAINMENT",val:r.entertainment,color:"#ff55ff"},
                   {label:"THREAT",val:r.threat,color:"#ff5555"},
                   {label:"SURVIVAL",val:r.survival,color:"#55ff55"}
                  ].map(({label,val,color}) => (
                    <div key={label} className="rating-row">
                      <span className="rating-label">{label}</span>
                      <div className="rating-bar-track" style={{flex:1}}>
                        <div className="rating-bar-fill" style={{width:`${val}%`,background:color}} />
                      </div>
                      <span className="rating-val" style={{color}}>{val}</span>
                    </div>
                  ))
                ) : (
                  <div className="dim" style={{fontSize:13}}>// Rank 5 unlocks Grid Rating bars.</div>
                )}

                {player.level >= 9 ? (
                  sponsor ? (
                    <div className="sponsor-card mt-8" style={{borderColor:sponsor.color}}>
                      <div className="sponsor-name" style={{color:sponsor.color}}>{sponsor.name}</div>
                      <div className="sponsor-tagline">"{sponsor.tagline}"</div>
                      {sponsor.perks.map((p,i) => <div key={i} className="sponsor-perk">{p}</div>)}
                    </div>
                  ) : (
                    <div className="dim mt-8" style={{fontSize:13}}>// No sponsor yet. Build your ratings.</div>
                  )
                ) : (
                  <div className="dim mt-8" style={{fontSize:13}}>// Rank 9 unlocks sponsors.</div>
                )}
              </div>
            );
          })()}
        </div>
        )}

        {/* Sub-menu for runner */}
        <div className="panel">
          <div className="panel-title">// RUNNER OPTIONS</div>
          <div className="lord-menu">
            <button className="lord-item" onClick={() => setTab("runner_inventory")}>
              <span className="lord-key">[I]</span>
              <span className="lord-name">Inventory</span>
              <span className="lord-hint">{(player.inventory||[]).reduce((s,i)=>s+i.qty,0)}/{MAX_INV_SLOTS*MAX_STACK} items</span>
            </button>
            <button className="lord-item" onClick={() => { setTab("runner_skills"); }}>
              <span className="lord-key">[S]</span>
              <span className="lord-name">Skill Tree{perkAlert?" ★":""}</span>
              <span className="lord-hint">{(player.perks||[]).length} perks · {player.perkPoints||0} points pending</span>
            </button>
            <button className="lord-item" onClick={() => { setTab("runner_faction"); if(!factionData)fetchFactionData(); }}>
              <span className="lord-key">[F]</span>
              <span className="lord-name">Faction</span>
              <span className="lord-hint">{player.factionId ? FACTIONS[player.factionId]?.name : "No faction — join one"}</span>
            </button>
            {player.inCollective && (
              <button className="lord-item" onClick={() => { setTab("runner_collective"); fetchCollectiveChat(); }}>
                <span className="lord-key" style={{color:"#ffffff"}}>◬</span>
                <span className="lord-name" style={{color:"#cccccc"}}>// encrypted channel</span>
                <span className="lord-hint">members only</span>
              </button>
            )}
            {collectiveEligible && !player.inCollective && (
              <button className="lord-item" onClick={() => setTab("runner_collective_join")}>
                <span className="lord-key" style={{color:"#666666"}}>?</span>
                <span className="lord-name" style={{color:"#2a2a2a"}}>// unknown signal</span>
                <span className="lord-hint" style={{color:"#111111"}}>do not ignore</span>
              </button>
            )}
          </div>
        </div>

        {streakModal && renderStreakModal()}
        {showPerkModal && renderPerkModal()}
      </div>
    );

    if (tab === "runner_inventory") return (
      <div>
        <button className="lord-back" onClick={() => setTab("runner")}>&#9666; BACK</button>
        <div className="panel"><div className="panel-title">// INVENTORY</div>{renderInventoryTab(false)}</div>
      </div>
    );

    if (tab === "runner_skills") return (
      <div>
        <button className="lord-back" onClick={() => setTab("runner")}>&#9666; BACK</button>
        <div className="panel">
          <div className="panel-title">// SKILL TREE</div>
          {renderSkillTree()}
        </div>
        {showPerkModal && renderPerkModal()}
      </div>
    );

    if (tab === "runner_faction") return (
      <div>
        <button className="lord-back" onClick={() => setTab("runner")}>&#9666; BACK</button>
        <div className="panel"><div className="panel-title">// FACTION</div>{renderFactionTab()}</div>
      </div>
    );

    // COLLECTIVE — JOIN RITUAL
    if (tab === "runner_collective_join") return (
      <div>
        <button className="lord-back" onClick={() => setTab("runner")}>&#9666; BACK</button>
        <div className="panel">
          <div className="collective-symbol">◬ ◬ ◬</div>
          <div className="collective-portal">
            <div className="collective-clue">
              {getCurrentCycle().staticClue}
            </div>
          </div>
          <div className="dim mb-8" style={{textAlign:"center",fontSize:12,letterSpacing:".1em"}}>
            // you have been found eligible. this door opens once.
          </div>
          <button className="btn btn-full" style={{borderColor:"#ffffff",color:"#ffffff",letterSpacing:".2em"}}
            onClick={handleJoinCollective}>
            ◬ ENTER
          </button>
        </div>
      </div>
    );

    // COLLECTIVE — MEMBER CHANNEL
    if (tab === "runner_collective") return (
      <div>
        <button className="lord-back" onClick={() => setTab("runner")}>&#9666; BACK</button>
        <div className="panel">
          <div className="collective-symbol">◬</div>
          <div className="collective-induction" style={{marginBottom:10}}>
            <div className="collective-induction-title">// THE GHOST COLLECTIVE // ENCRYPTED //</div>
            <div className="collective-induction-body">
              You are one of {" "}
              <span style={{color:"#ffffff"}}>the few</span>
              . This channel is invisible to everyone else on the grid.
              {" "}Cycle {getCurrentCycle().cycle} · {getCurrentCycle().label}
            </div>
            <div className="dim mt-8" style={{fontSize:12}}>
              Next cycle in {Math.ceil(getNextCycleMs() / (1000*60*60*24))} days · conditions change · new members possible
            </div>
          </div>
          <div className="flex-between mb-8">
            <div className="dim" style={{fontSize:12,letterSpacing:".1em"}}>// SECURE CHANNEL</div>
            <button className="btn btn-sm" onClick={fetchCollectiveChat} disabled={collectiveChatLoading}>↻</button>
          </div>
          <div className="collective-chat-feed">
            {collectiveChatLoading && collectiveChat.length === 0 && (
              <div className="dim" style={{textAlign:"center",padding:8}}>// Decrypting...</div>
            )}
            {!collectiveChatLoading && collectiveChat.length === 0 && (
              <div className="dim" style={{textAlign:"center",padding:8}}>// No transmissions. Be first.</div>
            )}
            {collectiveChat.map((msg, i) => {
              const cls = CLASSES[msg.cls];
              const age = Date.now() - msg.ts;
              const ageStr = age < 3600000 ? `${Math.floor(age/60000)}m` : age < 86400000 ? `${Math.floor(age/3600000)}h` : `${Math.floor(age/86400000)}d`;
              return (
                <div key={msg.id} className="collective-msg">
                  <span style={{color:"#888888",marginRight:6}}>{ageStr}</span>
                  <span style={{color:"#cccccc",marginRight:6}}>{cls?.icon} {msg.name}</span>
                  <span style={{color:"#666666"}}>{msg.text}</span>
                </div>
              );
            })}
          </div>
          <div className="chat-input-row">
            <textarea className="chat-input" rows={1} placeholder="Transmit..."
              value={collectiveChatInput} maxLength={140}
              onChange={e => setCollectiveChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCollectiveChat(); } }}
              disabled={collectiveChatLoading} />
            <button className="btn btn-sm" style={{borderColor:"#ffffff",color:"#ffffff",flexShrink:0}}
              onClick={handleCollectiveChat} disabled={!collectiveChatInput.trim() || collectiveChatLoading}>
              SEND
            </button>
          </div>
        </div>
      </div>
    );

    // THE WORLD
    if (tab === "world") return (
      <div>
        {backBtn}
        <button className="btn btn-sm" style={{marginBottom:8,marginLeft:8,color:"#888888",borderColor:"#333333"}} onClick={()=>setHelpScreen("world")}>? Help</button>
        <AnsiGrid rows={HEADERS.world} scale={1.0} />
        <div className="panel">
          <div className="panel-title">// THE WORLD</div>
          <div className="lord-menu">
            <button className="lord-item" onClick={() => setTab("world_leaderboard")}>
              <span className="lord-key">[L]</span>
              <span className="lord-name">Leaderboard</span>
              <span className="lord-hint">top runners · hall of fame</span>
            </button>
            <button className="lord-item" onClick={() => { setTab("world_rivals"); if(!player.runners)refreshRunners(player); }}>
              <span className="lord-key">[H]</span>
              <span className="lord-name">Hit List</span>
              <span className="lord-hint">attack runners · collect bounties</span>
            </button>
            <button className="lord-item" onClick={() => { setTab("world_faction"); if(!factionData)fetchFactionData(); }}>
              <span className="lord-key">[F]</span>
              <span className="lord-name">Faction War</span>
              <span className="lord-hint">weekly standings · who's winning</span>
            </button>
          </div>
        </div>
      </div>
    );

    if (tab === "world_leaderboard") return (
      <div>
        <button className="lord-back" onClick={() => setTab("world")}>&#9666; BACK</button>
        <div className="panel"><div className="panel-title">// LEADERBOARD</div>{renderLeaderboardTab()}</div>
      </div>
    );

    if (tab === "world_rivals") return (
      <div>
        <button className="lord-back" onClick={() => setTab("world")}>&#9666; BACK</button>
        <AnsiGrid rows={HEADERS.pvp} scale={1.0} />
        <div className="panel">
          <div className="panel-title">// HIT LIST</div>
          <div className="flex-between mb-8">
            <p className="dim" style={{lineHeight:1.6}}>
              Attack runners to steal credits. Lose and they earn a bounty on you.
              {(player.bounties||[]).length>0&&<><br/><span style={{color:"#ffff55"}}>⚠ {player.bounties.length} bounty target{player.bounties.length>1?"s":""} — pay {Math.round(PVP_BOUNTY_BONUS*100)}% more loot.</span></>}
            </p>
            <button className="btn btn-sm" onClick={()=>refreshRunners(player)} style={{flexShrink:0,marginLeft:10}}>↻</button>
          </div>
          {(player.runners||generateRunners(player.level)).map(runner => {
            const isBounty = (player.bounties||[]).includes(runner.handle);
            const cls2 = CLASSES[runner.cls];
            return (
              <div key={runner.id} className={`runner-card ${runner.safeMode?"safe":""} ${isBounty?"bounty":""}`}>
                <div className="flex-between">
                  <div>
                    <span className="runner-handle clickable-name" style={{color:isBounty?"#ffff55":cls2.color}}
                      onClick={() => viewProfile(runner.handle, runner.cls)}>
                      {cls2.icon} {runner.handle}
                      {isBounty&&<span style={{fontSize:11,background:"#ffff55",color:"#000",padding:"1px 5px",marginLeft:6}}>BOUNTY</span>}
                      {runner.safeMode&&<span style={{fontSize:11,background:"#55ffff",color:"#000",padding:"1px 5px",marginLeft:6}}>SAFE</span>}
                    </span>
                    <div className="runner-taunt">"{runner.taunt}"</div>
                    <div className="runner-stats">
                      <span>R<span>{runner.level}</span></span>
                      <span>ATK<span>{runner.atk}</span></span>
                      <span>DEF<span>{runner.def}</span></span>
                      <span>₡<span style={{color:"#ffff55"}}>{runner.credits}</span></span>
                    </div>
                  </div>
                  <button className="btn btn-danger btn-sm" style={{flexShrink:0,marginLeft:10}}
                    disabled={runner.safeMode||player.turnsLeft<=0||narLoading}
                    onClick={()=>handleAttackRunner(runner)}>
                    {runner.safeMode?"🛡 SAFE":"◆ ATTACK"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );

    if (tab === "world_faction") return (
      <div>
        <button className="lord-back" onClick={() => setTab("world")}>&#9666; BACK</button>
        <div className="panel"><div className="panel-title">// FACTION WAR</div>{renderFactionTab()}</div>
      </div>
    );

    return null;
  };

  // ── SKILL TREE RENDER (extracted for reuse) ──────────────────────────────
  const renderSkillTree = () => {
    const tree = SKILL_TREES[player.cls];
    const owned = player.perks || [];
    const clsColor = tree.color;
    return (
      <div>
        <div className="flex-between mb-8">
          <div className="dim" style={{lineHeight:1.6}}>
            Unlock perks every 2 levels.<br/>
            Owned: <span style={{color:clsColor}}>{owned.length}</span> · {player.perkPoints||0} points pending
          </div>
          {(player.perkPoints||0)>0&&(
            <span className="perk-point-badge" onClick={()=>setShowPerkModal(true)}>
              ⚡ {player.perkPoints} PERK{player.perkPoints>1?"S":""} READY
            </span>
          )}
        </div>
        <div className="skill-tree-grid">
          {Object.entries(tree.paths).map(([pathKey,path]) => (
            <div key={pathKey} className="skill-path-col">
              <div className="skill-path-header" style={{color:clsColor}}>{path.icon} {path.label}</div>
              {path.perks.map(perk => {
                const isOwned = owned.includes(perk.id);
                const tierReq = getPerkTierRequired(perk.tier);
                const prevOwned = perk.tier===1?true:owned.includes(path.perks.find(p2=>p2.tier===perk.tier-1)?.id);
                const isLocked = player.level<tierReq||!prevOwned;
                return (
                  <div key={perk.id} className={`perk-card ${isLocked?"locked":""} ${isOwned?"owned":""}`}>
                    <div className="perk-name" style={{color:isOwned?clsColor:isLocked?"#555555":"#aaaaaa"}}>{perk.name}</div>
                    <div className="perk-desc">{perk.desc}</div>
                    <span className="perk-tier" style={{background:isOwned?`${clsColor}20`:"transparent",color:isOwned?clsColor:"#555555",border:`1px solid ${isOwned?clsColor:"#555555"}`}}>
                      {isOwned?"✓ INSTALLED":isLocked?`LOCKED (rank ${tierReq})`:"AVAILABLE"}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── PERK MODAL (extracted for reuse) ────────────────────────────────────
  const renderPerkModal = () => {
    const tree = SKILL_TREES[player.cls];
    const available = getAvailablePerks(player);
    const clsColor = tree.color;
    return (
      <div className="perk-modal">
        <div className="perk-modal-inner">
          <div className="perk-modal-title">⚡ RANK UP — INSTALL A PERK</div>
          <div className="perk-modal-sub">{player.perkPoints} point{player.perkPoints>1?"s":""} available</div>
          {["offense","defense","utility"].map(pathKey => {
            const path = tree.paths[pathKey];
            const pathPerks = available.filter(p=>p.path===pathKey);
            if (!pathPerks.length) return null;
            return (
              <div key={pathKey}>
                <div className="perk-path-label">{path.icon} {path.label}</div>
                {pathPerks.map(perk => (
                  <div key={perk.id} className="perk-card" onClick={()=>handlePickPerk(perk)}>
                    <div className="perk-name" style={{color:clsColor}}>{perk.name}</div>
                    <div className="perk-desc">{perk.desc}</div>
                    <span className="perk-tier" style={{background:`${clsColor}18`,color:clsColor,border:`1px solid ${clsColor}`}}>
                      TIER {perk.tier} — CLICK TO INSTALL
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
          <button className="btn btn-full mt-12" onClick={()=>setShowPerkModal(false)}>◇ DECIDE LATER</button>
        </div>
      </div>
    );
  };

  // ── STREAK MODAL (extracted for reuse) ──────────────────────────────────
  const renderProfileModal = () => {
    if (!profileTarget) return null;
    const data = profileData;
    const cls = data ? CLASSES[data.cls] : CLASSES[profileTarget.cls];
    const isOwnProfile = profileTarget.name === player.name && profileTarget.cls === player.cls;
    const faction = data?.factionId ? FACTIONS[data.factionId] : null;
    const rank = data ? getFactionRank(data.factionXP || 0) : null;

    return (
      <div className="profile-modal" onClick={closeProfile}>
        <div className="profile-inner" onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="profile-header">
            <div className="profile-name" style={{color: cls?.color || "#55ff55"}}>
              {cls?.icon} {profileTarget.name}
              {data?.bossDefeated && <span style={{color:"#ffff55",marginLeft:8,fontSize:14}}>★ MAINFRAME CRACKED</span>}
            </div>
            <div className="profile-sub">
              {cls?.name || profileTarget.cls} · {data ? `RANK ${data.level}` : "..."}
              {faction && <span style={{color:faction.color,marginLeft:8}}>{faction.icon} {faction.name} [{rank?.name}]</span>}
            </div>
          </div>

          {profileLoading && <div className="dim" style={{padding:20,textAlign:"center"}}>// Loading runner data...</div>}

          {!profileLoading && !data && (
            <div className="dim" style={{padding:20,textAlign:"center"}}>
              // No profile data found.<br/>This runner hasn't jacked in yet or hasn't saved a session.
            </div>
          )}

          {!profileLoading && data && (<>
            {/* Stats grid */}
            <div className="profile-stats">
              <div className="profile-stat">
                <div className="profile-stat-label">Kills</div>
                <div className="profile-stat-val">{data.kills}</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-label">PvP</div>
                <div className="profile-stat-val">
                  <span style={{color:"#55ff55"}}>{data.pvpWins}W</span>
                  <span style={{color:"#888888"}}>/</span>
                  <span style={{color:"#ff5555"}}>{data.pvpLosses}L</span>
                </div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-label">Streak</div>
                <div className="profile-stat-val">🔥 {data.loginStreak} days</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-label">Perks</div>
                <div className="profile-stat-val">{data.perks} installed</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-label">Credits</div>
                <div className="profile-stat-val" style={{color:"#ffff55"}}>₡{data.credits?.toLocaleString()}</div>
              </div>
              <div className="profile-stat">
                <div className="profile-stat-label">Faction XP</div>
                <div className="profile-stat-val">{data.factionXP || 0}</div>
              </div>
            </div>

            {/* Titles & badges */}
            {((data.dungeonTitles||[]).length > 0 || (data.badges||[]).length > 0) && (
              <div className="profile-titles">
                {(data.dungeonTitles||[]).map(t => (
                  <span key={t} className="streak-badge" style={{borderColor:"#55ffff",color:"#55ffff"}}>{t}</span>
                ))}
                {(data.badges||[]).map(b => (
                  <span key={b} className="streak-badge">{b.replace(/_/g," ")}</span>
                ))}
              </div>
            )}

            {/* Achievements */}
            {(data.badges||[]).length > 0 && (
              <div className="profile-msgs">
                <div className="profile-lyra-label" style={{marginBottom:6}}>
                  ACHIEVEMENTS ({(data.badges||[]).length})
                </div>
                {(data.badges||[]).map(id => {
                  const a = ACHIEVEMENTS[id];
                  if (!a) return null;
                  return (
                    <div key={id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"5px 0",borderBottom:"1px solid #111"}}>
                      <span style={{fontSize:16,flexShrink:0}}>{a.icon}</span>
                      <div>
                        <div style={{fontSize:12,color:"#ffffff",fontWeight:700}}>{a.name}</div>
                        <div style={{fontSize:11,color:"#555",lineHeight:1.6}}>{a.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Lyra's read */}
            {(profileLyra || !isOwnProfile) && (
              <div className="profile-lyra">
                <div className="profile-lyra-label">LYRA // CHARACTER READ</div>
                {profileLyra || <span style={{color:"#888888"}}>...</span>}
              </div>
            )}

            {/* Messages */}
            <div className="profile-msgs">
              <div className="profile-lyra-label" style={{marginBottom:6}}>
                MESSAGES ({profileMsgs.length}/10)
              </div>

           {/* Achievements */}
           {(profileTarget?.badges||[]).length > 0 && (
             <div style={{marginBottom:12}}>
               <div className="profile-lyra-label" style={{marginBottom:6}}>
                 ACHIEVEMENTS ({profileTarget.badges.length})
               </div>
               <div style={{display:"flex",flexDirection:"column",gap:4}}>
                 {profileTarget.badges.map(id => {
                   const a = ACHIEVEMENTS[id];
                   if (!a || a.secret) return null;
                   return (
                     <div key={id} style={{display:"flex",gap:8,alignItems:"flex-start",padding:"4px 0",borderBottom:"1px solid #111"}}>
                       <span style={{fontSize:16,flexShrink:0}}>{a.icon}</span>
                       <div>
                         <div style={{fontSize:12,color:"#ffffff",fontWeight:700}}>{a.name}</div>
                         <div style={{fontSize:11,color:"#555",lineHeight:1.5}}>{a.desc}</div>
                       </div>
                     </div>
                   );
                 })}
               </div>
             </div>
           )}

             {profileMsgs.length === 0 && (
                <div className="dim">// No messages yet. Leave one below.</div>
              )}
              {profileMsgs.map(msg => (
                <div key={msg.id} className="profile-msg">
                  <span className="profile-msg-from" style={{color: CLASSES[msg.fromCls]?.color || "#aaa"}}>
                    {CLASSES[msg.fromCls]?.icon} {msg.from} R{msg.fromLevel}:
                  </span>
                  {msg.text}
                  <span style={{color:"#666",marginLeft:6,fontSize:12}}>
                    {(() => { const age = Date.now()-msg.ts; return age<3600000?`${Math.floor(age/60000)}m ago`:age<86400000?`${Math.floor(age/3600000)}h ago`:`${Math.floor(age/86400000)}d ago`; })()}
                  </span>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="profile-actions">
              {!isOwnProfile && (
                <div className="profile-msg-row">
                  <input className="input" style={{fontSize:14,padding:"5px 10px"}}
                    placeholder="Leave a message..."
                    value={profileMsgInput} maxLength={120}
                    onChange={e => setProfileMsgInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handlePostProfileMsg()} />
                  <button className="btn btn-sm" style={{flexShrink:0}}
                    onClick={handlePostProfileMsg} disabled={!profileMsgInput.trim()}>
                    SEND
                  </button>
                </div>
              )}
              {!isOwnProfile && (
                <button className="btn btn-danger btn-full" onClick={() => {
                  closeProfile();
                  setTab("world_rivals");
                }}>
                  ◆ VIEW ON HIT LIST
                </button>
              )}
              {!isOwnProfile && player.credits >= 50 && (
                <button className="btn btn-full" style={{borderColor:"#55ff55",color:"#55ff55"}}
                  onClick={async () => {
                    let p = { ...player, credits: player.credits - 50, carePackagesSent: (player.carePackagesSent||0) + 1 };
                    p = applyRatingEvent(p, "mercy");
                    save(p);
                    await logOfflineAttack(profileTarget.name, profileTarget.cls, {
                      attackerName: player.name, attackerCls: player.cls,
                      attackerLevel: player.level, creditsStolen: -50,
                      won: true, isGift: true, ts: Date.now(),
                    });
                    closeProfile();
                    setNarration(`// Care package sent to ${profileTarget.name}. ₡50 transferred. +REP`);
                  }}>
                  ◈ SEND CARE PACKAGE (₡50) +REP
                </button>
              )}
              <button className="btn btn-full" onClick={closeProfile}>
                [ESC] CLOSE
              </button>
            </div>
          </>)}
        </div>
      </div>
    );
  };

  // ── HELP SYSTEM ──────────────────────────────────────────────────────────────
  const HELP_CONTENT = {
    main: {
      title: "NETRUNNER // HOW TO PLAY",
      sections: [
        {
          title: "WHAT IS THIS",
          lines: [
            "NETRUNNER is a multiplayer cyberpunk RPG in the tradition",
            "of BBS door games like LORD (Legend of the Red Dragon, 1989).",
            "You are a hacker on a dark web network called the Grid.",
            "Other real players are on the same grid. They can see your",
            "leaderboard score, attack you, and leave you messages.",
          ]
        },
        {
          title: "THE BASIC LOOP",
          lines: [
            "You get <hl>10 turns</hl> per day. They reset at midnight.",
            "Each turn spent diving into the Grid costs <hl>1 turn</hl>.",
            "Dungeons cost <hl>3 turns</hl> to enter.",
            "Kill enemies to earn <hl-y>credits</hl-y> and <hl-c>XP</hl-c>.",
            "Level up to get stronger and unlock new areas.",
            "Beat the <hl-r>MEGACORP MAINFRAME</hl-r> to win the season.",
          ]
        },
        {
          title: "NAVIGATION",
          lines: [
            "Press a letter key to go to that location.",
            "<key>G</key> Grid  <key>D</key> Dungeons  <key>Q</key> Quests  <key>R</key> Refuge  <key>M</key> Market",
            "<key>P</key> Profile  <key>W</key> World  <key>?</key> Help  <key>ESC</key> Back",
            "Keyboard shortcuts work everywhere once you click the screen.",
          ]
        },
        {
          title: "NEED MORE HELP",
          lines: [
            "Press <key>?</key> on any screen for context-specific help.",
            "Each location has its own explanation.",
          ]
        }
      ]
    },
    grid: {
      title: "THE GRID // HELP",
      sections: [
        {
          title: "WHAT IS THE GRID",
          lines: [
            "The Grid is the main battlefield — the dark web network",
            "where corps run their ICE and runners make their living.",
            "Each dive is a random encounter with an enemy.",
          ]
        },
        {
          title: "HOW RUNS WORK",
          lines: [
            "Press <key>G</key> or the button to dive in. Costs <hl>1 turn</hl>.",
            "You'll fight an enemy scaled to your level.",
            "Win: earn <hl-y>credits</hl-y>, <hl-c>XP</hl-c>, sometimes loot.",
            "Lose: lose some HP. You don't die permanently.",
            "You can run away from any fight using <key>F</key> — but it costs a turn.",
          ]
        },
        {
          title: "TURNS",
          lines: [
            "You have <hl>10 turns per day</hl>. They reset at midnight.",
            "Login streak bonuses can give you extra turns.",
            "Dungeons cost 3 turns — plan accordingly.",
            "When turns hit 0, come back tomorrow.",
          ]
        },
        {
          title: "LEVELING UP",
          lines: [
            "XP fills the REP bar. Fill it to rank up.",
            "Each rank gives +15 max HP, +2 ATK, +1 DEF.",
            "Every 2 ranks you get a <hl-m>perk point</hl-m> to spend on skills.",
            "Higher rank = tougher enemies = more rewards.",
          ]
        }
      ]
    },
    dungeons: {
      title: "DEEP GRID RUNS // HELP",
      sections: [
        {
          title: "WHAT ARE DUNGEONS",
          lines: [
            "Dungeons are multi-room crawls deeper into the Grid.",
            "5 rooms each, with a boss at the end.",
            "They cost <hl>3 turns</hl> to enter — no refund if you flee.",
          ]
        },
        {
          title: "THE KEY RULES",
          lines: [
            "Your <hl-r>HP carries between rooms</hl-r>. No healing mid-dungeon.",
            "Clear each room to cache loot. Die and lose all of it.",
            "You can flee at any time but lose everything cached.",
            "Beat the boss to collect all loot + a title reward.",
          ]
        },
        {
          title: "DUNGEON KEYS",
          lines: [
            "<key>F</key> Fight the current room  <key>N</key> Next room (after clear)",
            "<key>C</key> Collect loot and exit (after boss)  <key>ESC</key> Flee",
          ]
        },
        {
          title: "UNLOCK ORDER",
          lines: [
            "The Sewers unlocks at Rank 1.",
            "Corp Tower: Rank 3  ·  Black Market: Rank 5",
            "Military Grid: Rank 7  ·  The Mainframe: Rank 9 + boss clear",
          ]
        }
      ]
    },
    combat: {
      title: "COMBAT // HELP",
      sections: [
        {
          title: "HOW COMBAT WORKS",
          lines: [
            "Combat is turn-based. You and the enemy trade attacks.",
            "Each round you choose one action.",
            "The fight ends when someone reaches 0 HP.",
            "You never die permanently — you jack out and lose some credits.",
          ]
        },
        {
          title: "YOUR ACTIONS",
          lines: [
            "<key>A</key> EXPLOIT — Standard attack. Always available.",
            "<key>S</key> ABILITY — Your class special. Powerful but has a cooldown.",
            "<key>F</key> FLEE — Jack out. Ends the fight, costs 1 turn.",
          ]
        },
        {
          title: "STATUS EFFECTS",
          lines: [
            "<hl-r>BURN</hl-r> — Take damage each round until it clears.",
            "<hl-c>TRACED</hl-c> — Reduced defense. Corp enemies use this.",
            "<hl-y>OVERLOADED</hl-y> — Reduced attack output.",
            "Effects wear off after a few rounds.",
          ]
        },
        {
          title: "INVENTORY IN COMBAT",
          lines: [
            "If you have items in your bag, they appear below the log.",
            "Use consumables mid-fight to heal or buff yourself.",
            "Items are limited — use them wisely.",
          ]
        }
      ]
    },
    refuge: {
      title: "THE NEON REFUGE // HELP",
      sections: [
        {
          title: "WHAT IS THIS PLACE",
          lines: [
            "A basement node buried under three layers of encryption.",
            "The only place on the Grid where nobody shoots first.",
            "Two NPCs hold court here every night.",
          ]
        },
        {
          title: "LYRA",
          lines: [
            "Chrome-armed bartender. She's seen everything.",
            "Buy drinks for <hl-y>credits</hl-y> — they give temporary combat buffs.",
            "Some drinks heal HP. Others boost your next fight.",
            "She has opinions about you based on your reputation.",
          ]
        },
        {
          title: "STATIC",
          lines: [
            "Glitched AI DJ. Speaks in fragments and music metaphors.",
            "Pay <hl-y>₡20</hl-y> for grid intel — a tip about your next enemy.",
            "Also tells free rumors about what's happening on the Grid.",
          ]
        },
        {
          title: "OTHER OPTIONS",
          lines: [
            "<hl>Safe Mode</hl> — Pay ₡50 for 24hr PvP protection. Nobody can raid you.",
            "<hl>Dead Drop</hl> — Global chat. Every runner on the Grid can see this.",
            "<hl>Faction Chat</hl> — Private channel for your faction only.",
          ]
        }
      ]
    },
    market: {
      title: "BLACK MARKET // HELP",
      sections: [
        {
          title: "WHAT IS THE MARKET",
          lines: [
            "Permanent gear upgrades. No questions asked.",
            "Gear boosts your ATK and DEF permanently once bought.",
            "You keep gear between sessions — it doesn't wear out.",
          ]
        },
        {
          title: "BUYING GEAR",
          lines: [
            "Each item shows its ATK and DEF bonus.",
            "Once you own it, it's equipped automatically.",
            "You can own multiple pieces of gear — they stack.",
            "Some factions give you a discount here.",
          ]
        },
        {
          title: "YOUR BAG",
          lines: [
            "Consumable items also appear here.",
            "You can sell items you don't need for credits.",
            "Items drop from enemies and dungeon bosses.",
            "Max <hl>8 item slots</hl>, 3 per type.",
          ]
        }
      ]
    },
    runner: {
      title: "RUNNER PROFILE // HELP",
      sections: [
        {
          title: "YOUR STATS",
          lines: [
            "<hl>INTEGRITY</hl> — Your HP. Recovers slowly over time and at midnight.",
            "<hl>REP</hl> — XP toward your next rank.",
            "<hl>ATK</hl> — Damage you deal per attack.",
            "<hl>DEF</hl> — Damage reduction from incoming attacks.",
            "<hl>CRIT</hl> — Chance to deal double damage.",
          ]
        },
        {
          title: "SKILL TREE",
          lines: [
            "Every 2 ranks you earn a perk point.",
            "Perks permanently improve your stats or abilities.",
            "Each class has 3 paths: Offense, Defense, Utility.",
            "You can't undo perks — choose carefully.",
          ]
        },
        {
          title: "FACTIONS",
          lines: [
            "Join one of 3 factions to earn faction XP and bonuses.",
            "<hl-m>Ghost Protocol</hl-m> — XP bonuses, stealth focus.",
            "<hl-r>Deadlock</hl-r> — Credit bonuses, PvP focus.",
            "<hl-c>Cipher Syndicate</hl-c> — Ability and shop bonuses.",
            "You can switch factions but there's a 7-day cooldown.",
          ]
        },
        {
          title: "GRID RATING",
          lines: [
            "Unlocks at Rank 3. Three scores build as you play:",
            "<hl-m>Entertainment</hl-m> — Are you interesting to watch?",
            "<hl-r>Threat</hl-r> — How dangerous are you?",
            "<hl>Survival</hl> — How hard are you to kill?",
            "High ratings attract sponsors with gameplay bonuses.",
          ]
        }
      ]
    },
    world: {
      title: "THE WORLD // HELP",
      sections: [
        {
          title: "LEADERBOARD",
          lines: [
            "Top runners ranked by score. Season resets every 6 months.",
            "Score = Boss kill (100k) + Rank×5k + Kills×200 + Credits",
            "Your score auto-submits when you save.",
            "Hall of Fame records past season winners permanently.",
          ]
        },
        {
          title: "HIT LIST",
          lines: [
            "Attack other runners to steal a portion of their credits.",
            "Costs <hl>1 turn</hl> per attack attempt.",
            "Win: steal ~25% of their credits.",
            "Lose: they get a bounty on you — makes them tougher to beat.",
            "Players in <hl>Safe Mode</hl> can't be attacked.",
          ]
        },
        {
          title: "FACTION WAR",
          lines: [
            "Three factions compete for weekly FXP totals.",
            "Every kill, dungeon, and quest earns FXP for your faction.",
            "Winning faction gets a bonus for all members next week.",
            "Standings reset every 7 days.",
          ]
        },
        {
          title: "PLAYER PROFILES",
          lines: [
            "Click any runner's name in chat, leaderboard, or hit list",
            "to view their profile — stats, titles, rep, and messages.",
            "You can leave messages on anyone's profile.",
            "You can also send a <hl>care package</hl> (₡50) for rep.",
          ]
        }
      ]
    },
    quests: {
      title: "DAILY MISSIONS // HELP",
      sections: [
        {
          title: "HOW QUESTS WORK",
          lines: [
            "You get <hl>3 missions</hl> per day. They reset at midnight.",
            "Missions track things you're already doing — kills, runs, etc.",
            "Progress updates automatically as you play.",
            "When a mission is complete, come back here to claim the reward.",
          ]
        },
        {
          title: "REWARDS",
          lines: [
            "Each mission pays out <hl-y>credits</hl-y>, <hl-c>XP</hl-c>, and sometimes items.",
            "If you're in a faction, quest claims also earn <hl-m>faction XP</hl-m>.",
            "Claiming quests also builds your Grid Rating.",
          ]
        },
        {
          title: "DIFFICULTY",
          lines: [
            "<hl>Easy</hl> — Completable in a few runs.",
            "<hl-y>Medium</hl-y> — Requires most of your daily turns.",
            "<hl-r>Hard</hl-r> — May take multiple days of play.",
          ]
        }
      ]
    },
    faction: {
      title: "FACTIONS // HELP",
      sections: [
        {
          title: "WHAT ARE FACTIONS",
          lines: [
            "Three crews competing for weekly dominance of the Grid.",
            "Join one to earn Faction XP (FXP) and unlock bonuses.",
            "Faction standings reset every 7 days — weekly wars.",
          ]
        },
        {
          title: "EARNING FXP",
          lines: [
            "Kills: +5 FXP  ·  PvP wins: +25 FXP",
            "Quest claims: +30 FXP  ·  Boss kills: +100 FXP",
            "Dungeon clears: +75 FXP",
          ]
        },
        {
          title: "FACTION RANKS",
          lines: [
            "<hl>Recruit</hl> 0 FXP  →  <hl>Runner</hl> 200 FXP",
            "<hl>Operative</hl> 600 FXP  →  <hl>Elite</hl> 1500 FXP",
            "Higher rank = more bonuses from your faction.",
          ]
        },
        {
          title: "SWITCHING FACTIONS",
          lines: [
            "You can leave and rejoin a different faction.",
            "There's a <hl-r>7-day cooldown</hl-r> before you can switch again.",
            "Your FXP resets when you switch — plan accordingly.",
          ]
        }
      ]
    },
  };

  const renderHelp = () => {
    if (!helpScreen) return null;
    const content = HELP_CONTENT[helpScreen] || HELP_CONTENT.main;
    const dismiss = () => setHelpScreen(null);

    const renderLine = (line, i) => {
      // Parse inline markup: <hl>, <hl-y>, <hl-r>, <hl-c>, <hl-m>, <key>
      const parts = [];
      let remaining = line;
      let key = 0;
      const tags = {
        '<hl>': '#55ff55', '<hl-y>': '#ffff55', '<hl-r>': '#ff5555',
        '<hl-c>': '#55ffff', '<hl-m>': '#ff55ff',
      };
      // Simple regex parse
      const regex = /(<hl[^>]*>)(.*?)(<\/hl[^>]*>)|(<key>)(.*?)(<\/key>)/g;
      let lastIdx = 0;
      let match;
      while ((match = regex.exec(line)) !== null) {
        if (match.index > lastIdx) {
          parts.push(<span key={key++}>{line.slice(lastIdx, match.index)}</span>);
        }
        if (match[1]) { // hl tag
          const color = tags[match[1]] || '#55ff55';
          parts.push(<span key={key++} style={{color}}>{match[2]}</span>);
        } else { // key tag
          parts.push(<span key={key++} className="help-key">{match[5]}</span>);
        }
        lastIdx = match.index + match[0].length;
      }
      if (lastIdx < line.length) parts.push(<span key={key++}>{line.slice(lastIdx)}</span>);
      return <div key={i} className="help-line">{parts.length > 0 ? parts : line}</div>;
    };

    return (
      <div className="help-modal" onClick={dismiss}>
        <div className="help-inner" onClick={e => e.stopPropagation()}>
          <div className="help-header">
            <span className="help-title">{content.title}</span>
            <span className="dim" style={{fontSize:12}}>// SYSTEM GUIDE</span>
          </div>
          <div className="help-body">
            {content.sections.map((section, si) => (
              <div key={si} className="help-section">
                <div className="help-section-title">{section.title}</div>
                {section.lines.map((line, li) => renderLine(line, li))}
              </div>
            ))}
          </div>
          <div className="help-footer" onClick={dismiss}>
            [ PRESS ANY KEY OR TAP TO CLOSE ]
          </div>
        </div>
      </div>
    );
  };

  const renderTransmission = () => {
    if (!transmission) return null;
    const dismiss = () => setTransmission(null);
    const sponsor = transmission.sponsorId ? SPONSORS[transmission.sponsorId] : null;
    return (
      <div className="transmission-modal" onClick={dismiss}>
        <div className="transmission-inner" style={{borderColor: transmission.color, border:`1px solid ${transmission.color}`}}
          onClick={e => e.stopPropagation()}>
          <div className="transmission-header" style={{borderColor: transmission.color, color: transmission.color, background:`${transmission.color}10`}}>
            ◈ {transmission.title}
          </div>
          <div className="transmission-body">
            {transmission.body.split('\n').map((line, i) => (
              <div key={i} style={{
                color: line.startsWith('₡') || line.includes('₡') ? "#ffff55"
                  : line.startsWith('//') ? "#555555"
                  : "#aaaaaa",
                minHeight: line === "" ? "1em" : "auto",
              }}>{line}</div>
            ))}
            {sponsor && (
              <div style={{marginTop:12, borderTop:`1px solid ${sponsor.color}44`, paddingTop:10}}>
                <div style={{fontSize:12,color:sponsor.color,letterSpacing:".15em",marginBottom:6}}>SPONSOR BENEFITS NOW ACTIVE</div>
                {sponsor.perks.map((perk, i) => (
                  <div key={i} style={{fontSize:13,color:"#888888",marginBottom:3}}>
                    <span style={{color:"#55ff55"}}>+ </span>{perk}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="transmission-footer" onClick={dismiss}>
            [ PRESS ANY KEY TO ACKNOWLEDGE ]
          </div>
        </div>
      </div>
    );
  };

  const renderOnboarding = () => {
    if (!showOnboarding || !player) return null;
    const cls = CLASSES[player.cls];
    const dismiss = () => setShowOnboarding(false);
    return (
      <div className="onboard-modal" onClick={dismiss}>
        <div className="onboard-inner" onClick={e => e.stopPropagation()}>
          <div className="onboard-header">
            TRANSMISSION FROM: THE GRID // INCOMING
          </div>
          <div className="onboard-body">
            <div className="onboard-line highlight">
              Welcome to the grid, {player.name}.
            </div>
            <div className="onboard-line">&nbsp;</div>
            <div className="onboard-line">
              You get <span style={{color:"#55ff55"}}>10 RUNS</span> per day. They reset at midnight.
            </div>
            <div className="onboard-line">
              Each run costs <span style={{color:"#ffff55"}}>1 turn</span>. Dungeons cost <span style={{color:"#ffff55"}}>3</span>.
            </div>
            <div className="onboard-line">&nbsp;</div>
            <div className="onboard-line">
              Kill enemies to earn <span style={{color:"#ffff55"}}>credits</span> and <span style={{color:"#55ffff"}}>XP</span>.
            </div>
            <div className="onboard-line">
              Level up to unlock <span style={{color:cls.color}}>perks</span> and harder zones.
            </div>
            <div className="onboard-line">
              Beat the <span style={{color:"#ff5555"}}>MEGACORP MAINFRAME</span> to win.
            </div>
            <div className="onboard-line">&nbsp;</div>
            <div className="onboard-line warn">
              The grid is multiplayer. Other runners can
            </div>
            <div className="onboard-line warn">
              attack you while you're offline.
            </div>
            <div className="onboard-line warn">
              Attack them first.
            </div>
            <div className="onboard-line">&nbsp;</div>
            <div className="onboard-line dim">
              Good luck. You'll need it.
            </div>
            <div className="onboard-line sig">
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;— STATIC
            </div>
          </div>
          <div className="onboard-footer" onClick={dismiss}>
            [ PRESS ANY KEY TO JACK IN ]
          </div>
        </div>
      </div>
    );
  };

  const renderKillScreen = () => {
    if (!killScreen) return null;
    const { enemy, dmgDealt, dmgTaken, rounds, crits, loot, narration, leveled } = killScreen;
    const dismiss = () => {
      setKillScreen(null);
      if (leveled) setShowPerkModal(player?.perkPoints > 0 && getAvailablePerks(player).length > 0);
      setScreen("hub");
    };
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",zIndex:800,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
        <div style={{maxWidth:520,width:"100%",textAlign:"center"}}>

          {/* Title */}
          <div style={{fontSize:11,letterSpacing:".3em",color:"#ff5555",marginBottom:8}}>◆ ◆ ◆</div>
          <div className="kill-screen-title">FLATLINE CONFIRMED</div>
          <div className="kill-screen-enemy">
            {enemy.name} — {enemy.boss ? "BOSS ELIMINATED" : "ELIMINATED"}
          </div>

          {/* Stats grid */}
          <div className="kill-screen-stats">
            <div className="kill-stat">
              <div className="kill-stat-label">DAMAGE DEALT</div>
              <div className="kill-stat-value">{dmgDealt}</div>
            </div>
            <div className="kill-stat">
              <div className="kill-stat-label">DAMAGE TAKEN</div>
              <div className="kill-stat-value red">{dmgTaken}</div>
            </div>
            <div className="kill-stat">
              <div className="kill-stat-label">ROUNDS</div>
              <div className="kill-stat-value">{rounds}</div>
            </div>
            <div className="kill-stat">
              <div className="kill-stat-label">CRITICAL HITS</div>
              <div className="kill-stat-value yellow">{crits}</div>
            </div>
          </div>

          {/* Loot */}
          {loot > 0 && (
            <div style={{marginBottom:16,color:"#ffff55",fontSize:14,letterSpacing:".1em"}}>
              ₡{loot} LOOTED
            </div>
          )}

          {/* Narration */}
          {narration && (
            <div className="kill-screen-narration">{narration}</div>
          )}

          {/* Level up notice */}
          {leveled && (
            <div style={{marginBottom:16,color:"#55ffff",fontSize:13,letterSpacing:".15em",padding:"8px",border:"1px solid #55ffff"}}>
              ★ RANK UP — SYSTEM UPGRADED ★
            </div>
          )}

          {/* Continue */}
          <button className="btn btn-full" style={{
            padding:"12px",fontSize:14,letterSpacing:".15em",
            borderColor:"#55ff55",color:"#55ff55",marginTop:8,
          }} onClick={dismiss}>
            [ CONTINUE ]
          </button>
        </div>
      </div>
    );
  };

  const renderAttackLog = () => {
    if (!attackLog || attackLog.length === 0) return null;

    const wins   = attackLog.filter(e => e.won);
    const fails  = attackLog.filter(e => !e.won);
    const totalLost = wins.reduce((s, e) => s + (e.creditsStolen || 0), 0);
    const topAttacker = wins.length > 0
      ? wins.reduce((a, b) => (b.creditsStolen > a.creditsStolen ? b : a))
      : null;

    const ageStr = (ts) => {
      const age = Date.now() - ts;
      if (age < 3600000) return `${Math.floor(age / 60000)}m ago`;
      if (age < 86400000) return `${Math.floor(age / 3600000)}h ago`;
      return `${Math.floor(age / 86400000)}d ago`;
    };

    return (
      <div className="attack-log-modal">
        <div className="attack-log-inner">
          {/* Header */}
          <div className="attack-log-header">
            <div className="attack-log-title">⚠ INCOMING TRANSMISSION</div>
            <div className="attack-log-sub">
              Activity detected while you were offline — {attackLog.length} event{attackLog.length !== 1 ? "s" : ""}
            </div>
          </div>

          {/* Entries */}
          {attackLog.map((entry, i) => {
            const cls = CLASSES[entry.attackerCls];
            return (
              <div key={i} className="attack-log-entry">
                <div className="attack-log-icon">
                  {entry.isGift ? "◈" : entry.won ? "◆" : "◇"}
                </div>
                <div className="attack-log-text">
                  <span className="attack-log-attacker" style={{color: entry.isGift ? "#55ff55" : entry.won ? "#ff5555" : "#555555"}}>
                    {cls?.icon} {entry.attackerName}
                  </span>
                  {entry.isGift
                    ? <span style={{color:"#cccccc"}}> sent you a <span style={{color:"#55ff55"}}>care package</span> — ₡50 incoming</span>
                    : entry.won
                    ? <span style={{color:"#cccccc"}}> hit you and stole <span style={{color:"#ffff55"}}>₡{entry.creditsStolen}</span>{entry.isBounty ? " (bounty)" : ""}</span>
                    : <span style={{color:"#888888"}}> attempted to raid you — <span style={{color:"#55ff55"}}>FAILED</span></span>
                  }
                  <div className="attack-log-age">{ageStr(entry.ts)} · Rank {entry.attackerLevel} {cls?.name}</div>
                </div>
              </div>
            );
          })}

          {/* Summary */}
          <div className="attack-log-summary">
            {totalLost > 0
              ? <span style={{color:"#ff5555"}}>Total lost: <strong style={{color:"#ffff55"}}>₡{totalLost}</strong> across {wins.length} successful raid{wins.length !== 1 ? "s" : ""}</span>
              : <span style={{color:"#55ff55"}}>All raid attempts were repelled. Your defenses held.</span>
            }
            {fails.length > 0 && totalLost > 0 && (
              <span style={{color:"#888888"}}> · {fails.length} failed attempt{fails.length !== 1 ? "s" : ""}</span>
            )}
          </div>

          {/* Actions */}
          <div className="attack-log-actions">
            {topAttacker && (
              <button className="btn btn-danger" style={{flex:1}} onClick={() => {
                setAttackLog([]);
                // Prime retaliation — navigate to hit list
                setTab("world_rivals");
                setScreen("hub");
                setNarration(`// ${topAttacker.attackerName} hit you for ₡${topAttacker.creditsStolen} while you were gone. Time to even the score.`);
              }}>
                ◆ RETALIATE vs {topAttacker.attackerName.toUpperCase()}
              </button>
            )}
            <button className="btn" style={{flex:1}} onClick={() => setAttackLog([])}>
              {topAttacker ? "IGNORE" : "[C] CONTINUE"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderStreakModal = () => {
    const { streak, milestone, streakBroken, longestStreak } = streakModal;
    const next = getNextMilestone(streak);
    const today = new Date().toDateString();
    const history = player.loginHistory || [];
    const days = Array.from({length:7},(_,i)=>{
      const d = new Date(Date.now()-(6-i)*86400000);
      const ds = d.toDateString();
      return { label:["SU","MO","TU","WE","TH","FR","SA"][d.getDay()], isToday:ds===today, wasActive:history.includes(ds) };
    });
    return (
      <div className="streak-modal" onClick={()=>setStreakModal(null)}>
        <div className="streak-inner" onClick={e=>e.stopPropagation()}>
          {streakBroken?(
            <><div className="streak-fire" style={{filter:"grayscale(1)"}}>💀</div>
            <div className="streak-number" style={{color:"#ff5555"}}>0</div>
            <div className="streak-label" style={{color:"#ff5555"}}>STREAK BROKEN</div>
            <div className="dim">You missed a day. Don't let it happen again, runner.</div></>
          ):(
            <><div className="streak-fire">🔥</div>
            <div className="streak-number">{streak}</div>
            <div className="streak-label">{streak===1?"FIRST LOGIN":"DAY STREAK"}</div></>
          )}
          <div className="streak-calendar">
            {days.map((d,i)=>(
              <div key={i} className={`streak-day ${d.isToday?"today":d.wasActive?"active":""}`}>{d.label}</div>
            ))}
          </div>
          {milestone&&<div className="streak-milestone"><div className="streak-milestone-label">★ STREAK REWARD — {milestone.label}</div><div>{milestone.desc}</div></div>}
          {next&&<div className="streak-next">Next at <span>{next.day} days</span>: {next.desc} · {next.day-streak}d away</div>}
          {!next&&streak>=30&&<div className="streak-next" style={{color:"#ffff55"}}>★ MAX STREAK — GRID LEGEND</div>}
          <div className="dim mt-8">Longest: {longestStreak} days</div>
          <button className="btn btn-full mt-12" style={{borderColor:"#ffff55",color:"#ffff55"}} onClick={()=>setStreakModal(null)}>
            {streakBroken?"RESET AND GRIND":milestone?"CLAIM & CONTINUE":"CONTINUE"}
          </button>
        </div>
      </div>
    );
  };

  const renderRefuge = () => {
    const safeActive = isSafeModeActive(player);
    return (
      <div>
        <AnsiGrid rows={HEADERS.refuge} scale={1.0} />

        {/* NPC speech output */}
        {npcWho && <NpcBubble who={npcWho} text={npcText} loading={npcLoading} />}

        {/* Sub-tabs */}
        <div className="tabs" style={{ marginBottom: 12 }}>
          <button className={`tab ${refugeTab === "bar" ? "active" : ""}`}       onClick={() => setRefugeTab("bar")}>LYRA'S BAR</button>
          <button className={`tab ${refugeTab === "static" ? "active" : ""}`}    onClick={() => setRefugeTab("static")}>STATIC'S BOOTH</button>
          <button className={`tab ${refugeTab === "chat" ? "active" : ""}`}      onClick={() => { setRefugeTab("chat"); if (!chatMessages.length) fetchChat(); }}>DEAD DROP</button>
          <button className={`tab ${refugeTab === "safemode" ? "active" : ""}`}  onClick={() => setRefugeTab("safemode")}>SAFE MODE</button>
         <button className={`tab ${refugeTab==="leaderboard"?"active":""}`} onClick={() => { setRefugeTab("leaderboard"); fetchLeaderboard(); }} >LEADERBOARD</button>
         <button className={`tab ${refugeTab==="runners"?"active":""}`} onClick={() => setRefugeTab("runners")}>RUNNERS</button>
        </div>

        {/* LYRA */}
        {refugeTab === "bar" && (
          <div>
            <div className="npc-row">
              <div className="npc-avatar" style={{borderColor:"#ff55ff",background:"rgba(255,121,198,.08)"}}>💋</div>
              <div className="npc-info">
                <div className="npc-name" style={{color:"#ff55ff"}}>LYRA</div>
                <div className="npc-tagline">
                  Chrome-armed bartender. Sharp tongue, sharper memory.
                  {(player.lyraFlirtCount||0) >= 10 && <span style={{color:"#ff55ff",marginLeft:6}}>She knows your name.</span>}
                  {(player.lyraFlirtCount||0) >= 20 && <span style={{color:"#ff55ff",marginLeft:6}}>She's waiting for something.</span>}
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end"}}>
                <button className="btn btn-lyra btn-sm" onClick={handleLyraFlirt}
                  disabled={npcLoading || (player.lastFlirtDate || "") === new Date().toDateString()}>
                  {player.lastFlirtDate === new Date().toDateString() ? "♥ TOMORROW" : "♥ FLIRT"}
                </button>
                {(player.lyraFlirtCount||0) >= 30 && (player.rep||0) >= 200 && !lyraMarriage && (
                  <button className="btn btn-sm" style={{borderColor:"#ff55ff",color:"#ff55ff"}}
                    onClick={handleLyraPropose} disabled={npcLoading}>
                    💍 PROPOSE
                  </button>
                )}
              </div>
            </div>
            {(player.lyraFlirtCount||0) > 0 && (
              <div className="dim" style={{fontSize:11,marginBottom:8,textAlign:"right"}}>
                {player.lyraFlirtCount} visit{player.lyraFlirtCount !== 1 ? "s" : ""} · {(player.lyraFlirtCount||0) < 30 ? `${30-(player.lyraFlirtCount||0)} more to propose` : (player.rep||0) < 200 ? "Need +200 rep to propose" : "Ready to propose 💍"}
              </div>
            )}
            {lyraMarriage && (
              <div style={{fontSize:12,color:"#ff55ff",marginBottom:8,fontStyle:"italic"}}>
                {lyraMarriage.name === player.name ? "💍 Your wife is behind the bar." : `💍 Taken by ${lyraMarriage.name}. GRUNT is filling in.`}
              </div>
            )}
            <div className="separator" />
            <div className="dim mb-8">Order a drink — buffs your next run:</div>
            <div className="drink-grid">
              {DRINKS.map(d => (
                <div key={d.id} className="drink-card">
                  <div className="drink-name">{d.name}</div>
                  <div className="drink-desc">{d.desc}</div>
                  <div className="drink-price">{player.lyraFreedrinks ? "FREE" : `₡${d.price}`}</div>
                  <button className="btn btn-lyra btn-sm btn-full mt-8"
                    disabled={(player.credits < d.price && !player.lyraFreedrinks) || npcLoading}
                    onClick={() => handleLyraBuy(d)}>
                    {player.lyraFreedrinks ? "ORDER (FREE)" : "ORDER"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

                {/* STATIC */}
        {refugeTab === "static" && (
          <div>
            <div className="npc-row">
              <div className="npc-avatar" style={{ borderColor: "#55ffff", background: "rgba(189,147,249,.08)" }}>📡</div>
              <div className="npc-info">
                <div className="npc-name" style={{ color: "#55ffff" }}>STATIC</div>
                <div className="npc-tagline">Glitched-out AI DJ. Knows things they shouldn't.</div>
              </div>
            </div>
            <div className="separator" />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn btn-static btn-full" onClick={handleStaticRumor} disabled={npcLoading || player.credits < 20}>
                📡 BUY GRID INTEL (₡20)
              </button>
              <div className="dim" style={{ lineHeight: 1.6 }}>
                Static will reveal what kind of ICE is lurking in the grid before your next dive. The info persists until you use it.
                {player.scoutedEnemy && <span style={{ color: "#55ffff" }}><br />◈ Current intel: <strong>{player.scoutedEnemy}</strong> spotted</span>}
              </div>
              <div className="separator" />
              <button className="btn btn-static btn-full" onClick={handleStaticChat} disabled={npcLoading}>
                🎵 HEAR A RUMOR (FREE)
              </button>
              <div className="dim">Static rambles. Sometimes useful, always atmospheric.</div>
            </div>
          </div>
        )}

        {/* SAFE MODE */}
        {refugeTab === "safemode" && (
          <div>
            <div style={{ border: "1px solid var(--cyan)", padding: 14, borderRadius: 2, background: "rgba(0,229,255,.04)", marginBottom: 12 }}>
              <div style={{ fontFamily: "Orbitron", fontSize: 11, color: "var(--cyan)", letterSpacing: ".2em", marginBottom: 8 }}>◈ SAFE MODE — ₡{SAFEMODE_COST}</div>
              <div className="dim" style={{ lineHeight: 1.8 }}>
                Go fully dark. Encrypt your location, restore full integrity, clear all status effects.<br />
                <span style={{ color: "var(--cyan)" }}>PvP shield active for {SAFEMODE_HOURS} hours.</span> No runner can touch you while you're under.<br />
                You can still dive into the grid while in safe mode.
              </div>
            </div>
            {safeActive ? (
              <div className="safemode-banner" style={{ margin: 0 }}>
                <span>🛡</span><span>SAFE MODE ACTIVE · {safeModeRemaining(player)} remaining</span>
              </div>
            ) : (
              <button className="btn btn-cyan btn-full" onClick={handleSafeMode}
                disabled={player.credits < SAFEMODE_COST || narLoading}>
                {player.credits < SAFEMODE_COST ? `// NEED ₡${SAFEMODE_COST}` : `◈ ACTIVATE SAFE MODE (₡${SAFEMODE_COST})`}
              </button>
            )}
          </div>
        )}

        {/* DEAD DROP — global chat */}
        {refugeTab === "chat" && (
          <div>
            <div className="flex-between mb-8">
              <div className="dim" style={{lineHeight:1.6}}>
                Encrypted relay. All runners see this feed.<br/>
                <span style={{color:"#ff55ff"}}>140 chars · 30s cooldown · Keep it clean</span>
              </div>
              <button className="btn btn-sm" onClick={fetchChat} disabled={chatLoading}>↻ REFRESH</button>
            </div>

            <div className="chat-feed" ref={chatFeedRef}>
              {chatLoading && chatMessages.length === 0 && (
                <div className="dim" style={{textAlign:"center",padding:16}}>// Loading feed...</div>
              )}
              {!chatLoading && chatMessages.length === 0 && (
                <div className="dim" style={{textAlign:"center",padding:16}}>// Dead air. Be the first to transmit.</div>
              )}
              {/* Ghost collective dead drop clue — appears for non-members, vague */}
              {!player.inCollective && player.level >= 3 && chatMessages.length > 3 && (
                <div className="chat-msg system" style={{color:"#1a1a1a",fontSize:12}}>
                  {getCurrentCycle().deadDropClue}
                </div>
              )}
              {chatMessages.map((msg, i) => {
                const isYou = msg.type === "player" && msg.name === player.name && msg.cls === player.cls;
                const cls = msg.cls ? CLASSES[msg.cls] : null;
                const age = Date.now() - msg.ts;
                const ageStr = age < 60000 ? "now"
                  : age < 3600000 ? `${Math.floor(age/60000)}m`
                  : age < 86400000 ? `${Math.floor(age/3600000)}h`
                  : `${Math.floor(age/86400000)}d`;

                if (msg.type === "system") return (
                  <div key={msg.id} className="chat-msg system">
                    <span className="chat-meta">{ageStr}</span>
                    <span>{msg.text}</span>
                  </div>
                );
                if (msg.type === "event") return (
                  <div key={msg.id} className="chat-msg event">
                    <span className="chat-meta">{ageStr}</span>
                    <span>⚡ {msg.text}</span>
                  </div>
                );
                return (
                  <div key={msg.id} className={`chat-msg ${isYou ? "you" : ""}`}>
                    <span className="chat-meta">{ageStr}</span>
                    <span className="chat-handle clickable-name" style={{color: cls?.color || "#aaaaaa"}}
                      onClick={() => viewProfile(msg.name, msg.cls)}>
                      {cls?.icon} {msg.name}
                    </span>
                    <span className="dim" style={{marginRight:5}}>R{msg.level}</span>
                    <span className="chat-text">{msg.text}</span>
                  </div>
                );
              })}
            </div>

            <div className="chat-chars">{chatInput.length}/{CHAT_MAX_LEN}</div>
            <div className="chat-input-row">
              <textarea
                className="chat-input"
                placeholder="Transmit to the grid..."
                value={chatInput}
                maxLength={CHAT_MAX_LEN}
                rows={1}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                disabled={chatLoading || chatCooldown > 0}
              />
              <button className="btn btn-cyan" style={{flexShrink:0}}
                onClick={handleSendChat}
                disabled={!chatInput.trim() || chatLoading || chatCooldown > 0}>
                {chatCooldown > 0 ? `${chatCooldown}s` : "SEND"}
              </button>
            </div>
            {chatCooldown > 0 && (
              <div className="chat-cooldown">// Signal cooling down — {chatCooldown}s remaining</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCombat = () => {
    if (!enemy) return null;
    const cls = CLASSES[player.cls];
    const enemyPct = Math.max(0, (enemy.currentHp / enemy.hp) * 100);
    const playerHpPct = player.hp / player.maxHp;
    const canAbility = player.abilityCooldown === 0;
    return (
      <div>
        <Narration text={narration} loading={narLoading} />

        {/* Combatants side by side */}
        <div className="grid-2">
          <div className="panel" style={{borderColor: playerHpPct < 0.25 ? "#ff5555" : "#1a2e20"}}>
            <div style={{fontSize:14,color:cls.color,marginBottom:6,letterSpacing:".06em"}}>{cls.icon} {player.name}</div>
            <StatBar label="HP" value={player.hp} max={player.maxHp} type={playerHpPct < 0.25 ? "hp critical" : "hp"} />
            <div className="dim" style={{marginTop:4}}>ATK {calcAtk(player)} · DEF {calcDef(player)} · CRIT {Math.round(calcCrit(player)*100)}%</div>
            <StatusChips statuses={player.statusEffects} buff={player.nextFightBuff} />
            {playerHpPct < 0.25 && <div style={{fontSize:12,color:"#ff5555",marginTop:4}}>⚠ CRITICAL HP</div>}
          </div>
          <div className="enemy-card" style={{borderColor: enemy.boss ? "#ff5555" : "#aa0000"}}>
            <div className="enemy-name">
              {enemy.name}
              {enemy.boss && <span className="boss-tag">BOSS</span>}
            </div>
            <StatBar label="HP" value={enemy.currentHp} max={enemy.hp} type="hp" />
            <div className="dim" style={{marginTop:4}}>ATK {calcEnemyAtk(enemy)} · DEF {calcEnemyDef(enemy)}</div>
            <StatusChips statuses={enemy.statusEffects} />
            {enemy.ability && <div className="dim" style={{marginTop:4,color:"#ffff55"}}>⚠ {enemy.ability.name}</div>}
          </div>
        </div>

        {/* Ability panel */}
        <div style={{border:`1px solid ${canAbility ? cls.color : "#333"}`, padding:"8px 12px", marginBottom:10, background: canAbility ? `${cls.color}08` : "transparent"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:14,color:canAbility?cls.color:"#888888"}}>⚡ {cls.ability.name}</span>
            {!canAbility && <span style={{fontSize:12,color:"#888888"}}>READY IN {player.abilityCooldown} turns</span>}
            {canAbility && <span style={{fontSize:12,color:cls.color}}>READY</span>}
          </div>
          <div style={{fontSize:13,color:"#cccccc",marginTop:3}}>{cls.ability.desc}</div>
        </div>

        {/* Combat log */}
        <div className="panel" style={{padding:"8px 10px"}}>
          <div className="combat-log" ref={logRef} style={{maxHeight:100}}>
            {combatLog.length === 0 && <span className="dim">Choose an action below...</span>}
            {combatLog.map((l, i) => <div key={i} className={l.type}>&gt; {l.text}</div>)}
          </div>
        </div>

        {/* Inventory during combat */}
        {(player.inventory||[]).length > 0 && (
          <div className="panel" style={{marginBottom:8,padding:"8px 10px"}}>
            <div className="location-header" style={{marginBottom:6}}>BAG — USE ITEMS</div>
            {renderInventoryTab(true)}
          </div>
        )}

        {/* Action buttons */}
        <div className="action-grid">
          <button className="btn" style={{padding:"12px 8px"}} onClick={handleAttack} disabled={narLoading}>
            [A] EXPLOIT
          </button>
          <button className="btn btn-purple" style={{padding:"12px 8px"}} onClick={handleAbility} disabled={narLoading || !canAbility}>
            {canAbility ? "[S] ABILITY" : `CD: ${player.abilityCooldown}`}
          </button>
          <button className="btn btn-danger" style={{padding:"12px 8px"}} onClick={handleJackOut} disabled={narLoading}>
            [F] FLEE
          </button>
        </div>
        <div className="combat-action-hint">A = attack · S = special ability · F = jack out (costs 1 turn)</div>
      </div>
    );
  };

  const renderInventoryTab = (inCombat = false) => {
    const inv = player.inventory || [];
    const slots = Array(MAX_INV_SLOTS).fill(null).map((_, i) => inv[i] || null);
    const totalItems = inv.reduce((s, i) => s + i.qty, 0);
    return (
      <div>
        <div className="flex-between mb-8">
          <div className="dim" style={{lineHeight:1.7}}>
            {totalItems}/{MAX_INV_SLOTS} slots used · Items drop from enemies · Stack up to {MAX_STACK}
          </div>
        </div>
        <div className="inv-grid">
          {slots.map((slot, i) => {
            if (!slot) return (
              <div key={i} className="inv-slot empty">
                <div style={{fontSize:20,opacity:.3}}>□</div>
                <div className="inv-name">empty</div>
              </div>
            );
            const item = CONSUMABLES[slot.id];
            if (!item) return null;
            const canUse = inCombat ? item.useInCombat : item.useInHub;
            return (
              <div key={i} className={`inv-slot ${item.rarity}`}>
                <div className="inv-qty">×{slot.qty}</div>
                <div className="inv-icon">{item.icon}</div>
                <div className={`inv-name rarity-${item.rarity}`}>{item.name}</div>
                <div className="inv-tooltip">{item.desc}</div>
                <div className="inv-actions">
                  <button className="btn btn-sm" style={{fontSize:12,padding:"3px 8px"}}
                    disabled={!canUse} onClick={() => handleUseItem(slot.id, inCombat)}
                    title={!canUse ? (inCombat ? "Hub only" : "Combat only") : "Use"}>
                    USE
                  </button>
                  {!inCombat && (
                    <button className="btn btn-sm btn-danger" style={{fontSize:12,padding:"3px 8px"}}
                      onClick={() => handleSellItem(slot.id)} title={`Sell for ₡${item.sellPrice}`}>
                      ₡{item.sellPrice}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {!inCombat && (
          <div className="dim mt-8" style={{lineHeight:1.7}}>
            Common drops: white border · Uncommon: cyan · Rare: purple<br/>
            Sell price = half value. Combat-only items can't be used from hub.
          </div>
        )}
      </div>
    );
  };

  const renderQuestsTab = () => {
    const quests = player.quests || [];
    const today = new Date();
    const midnight = new Date(today); midnight.setHours(24,0,0,0);
    const msLeft = midnight - today;
    const hLeft = Math.floor(msLeft/3600000);
    const mLeft = Math.floor((msLeft%3600000)/60000);
    return (
      <div>
        <div className="flex-between mb-8">
          <div className="dim" style={{lineHeight:1.6}}>3 daily missions · Resets in <span style={{color:"#ffff55"}}>{hLeft}h {mLeft}m</span></div>
        </div>
        {quests.length === 0 && <div className="dim" style={{textAlign:"center",padding:16}}>// No quests loaded. Try reloading.</div>}
        {quests.map(q => {
          const def = getQuestDef(q.id);
          if (!def) return null;
          const pct = Math.min(100, Math.floor((q.progress/def.goal)*100));
          const isComplete = q.progress >= def.goal;
          const isClaimed = q.claimed;
          const diffColor = def.diff==="easy" ? "#55ff55" : def.diff==="medium" ? "#ffff55" : "#ff5555";
          return (
            <div key={q.id} className={`quest-card ${isComplete&&!isClaimed?"complete":""} ${isClaimed?"claimed":""}`}>
              <div className="quest-header">
                <span className="quest-label" style={{color: isClaimed ? "#555555" : isComplete ? "#55ff55" : "#aaaaaa"}}>{def.label}</span>
                <span className="quest-diff" style={{borderColor:diffColor,color:diffColor}}>{def.diff.toUpperCase()}</span>
              </div>
              <div className="quest-desc">{def.desc}</div>
              <div className="quest-prog-track">
                <div className={`quest-prog-fill ${isComplete?"done":""}`} style={{width:`${pct}%`}} />
              </div>
              <div className="flex-between">
                <span className="quest-prog-text">{q.progress}/{def.goal}</span>
                <span className="quest-reward">
                  +₡{def.reward.credits} +{def.reward.xp}XP{def.reward.item?` +${CONSUMABLES[def.reward.item]?.icon||"?"}`:""}{player.factionId?` +${FXP_TABLE.questClaim}FXP`:""}
                </span>
              </div>
              {isComplete && !isClaimed && (
                <button className="btn btn-full mt-8" style={{borderColor:"#55ff55",color:"#55ff55"}} onClick={()=>handleClaimQuest(q.id)}>
                  ◈ CLAIM REWARD
                </button>
              )}
              {isClaimed && <div className="dim mt-8" style={{textAlign:"center"}}>// CLAIMED</div>}
            </div>
          );
        })}
      </div>
    );
  };

  const renderFactionTab = () => {
    const hasFaction = !!player.factionId;
    const currentFaction = hasFaction ? FACTIONS[player.factionId] : null;
    const rank = hasFaction ? getFactionRank(player.factionXP||0) : null;
    const nextRank = hasFaction ? FACTION_RANKS.find(r => r.fxpRequired > (player.factionXP||0)) : null;
    const fxpPct = hasFaction && nextRank
      ? Math.floor(((player.factionXP||0) - getFactionRank(player.factionXP||0).fxpRequired) / (nextRank.fxpRequired - getFactionRank(player.factionXP||0).fxpRequired) * 100)
      : 100;
    const canSwitch = !hasFaction || !player.factionJoinedAt || Date.now() - player.factionJoinedAt >= FACTION_WEEK_MS;
    const switchMs = hasFaction && player.factionJoinedAt ? Math.max(0, FACTION_WEEK_MS - (Date.now() - player.factionJoinedAt)) : 0;
    const switchDays = Math.ceil(switchMs / (1000 * 60 * 60 * 24));
    const totals = factionData?.totals || { ghost_protocol:0, deadlock:0, cipher_syndicate:0 };
    const totalFXP = Object.values(totals).reduce((s,v)=>s+v, 0) || 1;
    const lastWinner = factionData?.lastWinner;
    const [factionSubTab, setFactionSubTab] = [player._factionSubTab||"standings", (t) => save({...player, _factionSubTab:t})];

    return (
      <div>
        {/* Current faction status */}
        {hasFaction && (
          <div className="panel" style={{borderColor: currentFaction.color}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div>
                <span style={{fontSize:13,color:currentFaction.color,letterSpacing:".1em"}}>{currentFaction.icon} {currentFaction.name}</span>
                <span className="faction-rank-badge" style={{borderColor:currentFaction.color,color:currentFaction.color,marginLeft:10}}>{rank.name}</span>
              </div>
              <span className="dim">{player.factionXP||0} FXP</span>
            </div>
            {nextRank && (
              <>
                <div className="faction-xp-bar">
                  <div className="faction-xp-fill" style={{width:`${fxpPct}%`,background:currentFaction.color}} />
                </div>
                <div className="dim mt-8">{nextRank.fxpRequired-(player.factionXP||0)} FXP to {nextRank.name}</div>
              </>
            )}
            {!nextRank && <div className="dim mt-8" style={{color:currentFaction.color}}>MAX RANK — ELITE</div>}
          </div>
        )}

        {/* Last week winner */}
        {lastWinner && (
          <div className="faction-winner-banner" style={{borderColor:FACTIONS[lastWinner.id]?.color||"#555",color:FACTIONS[lastWinner.id]?.color||"#aaa"}}>
            ★ LAST WEEK: {FACTIONS[lastWinner.id]?.name} won with {lastWinner.fxp.toLocaleString()} FXP
          </div>
        )}

        {/* Sub-tabs */}
        <div className="tabs" style={{marginBottom:10}}>
          <button className={`tab ${factionSubTab==="standings"?"active":""}`} onClick={()=>save({...player,_factionSubTab:"standings"})}>STANDINGS</button>
          <button className={`tab ${factionSubTab==="join"?"active":""}`} onClick={()=>save({...player,_factionSubTab:"join"})}>
            {hasFaction ? "SWITCH" : "JOIN"}
          </button>
          {hasFaction && <button className={`tab ${factionSubTab==="chat"?"active":""}`} onClick={()=>{save({...player,_factionSubTab:"chat"});fetchFactionChat();}}>CREW CHAT</button>}
        </div>

        {/* STANDINGS */}
        {factionSubTab === "standings" && (
          <div>
            <div className="flex-between mb-8">
              <div className="dim">Week {factionData?.week||1} · Resets in {factionData ? Math.max(0,Math.ceil((FACTION_WEEK_MS-(Date.now()-factionData.weekStart))/(1000*60*60*24))) : "?"}d</div>
              <button className="btn btn-sm" onClick={fetchFactionData}>↻</button>
            </div>
            <div className="faction-standings">
              {Object.entries(FACTIONS).sort((a,b)=>(totals[b[0]]||0)-(totals[a[0]]||0)).map(([id,f],i) => {
                const fxp = totals[id]||0;
                const pct = Math.floor(fxp/totalFXP*100);
                const isYours = player.factionId === id;
                return (
                  <div key={id} className="faction-stand-row">
                    <span style={{color:f.color,fontSize:16,width:20}}>{i===0?"★":i===1?"▲":"▸"}</span>
                    <span style={{flex:1,color:f.color,fontSize:14}}>{f.icon} {f.name}{isYours?" (YOU)":""}</span>
                    <span className="dim" style={{marginRight:8}}>{fxp.toLocaleString()} FXP</span>
                    <span style={{color:f.color,fontSize:13}}>{pct}%</span>
                  </div>
                );
              })}
            </div>
            {/* Combined bar */}
            <div className="faction-bar-track">
              {Object.entries(FACTIONS).map(([id,f]) => (
                <div key={id} className="faction-bar-seg" style={{width:`${Math.floor((totals[id]||0)/totalFXP*100)}%`,background:f.color}} />
              ))}
            </div>
            <div className="dim mt-8">FXP earned from: kills ({FXP_TABLE.kill}) · PvP wins ({FXP_TABLE.pvpWin}) · quests ({FXP_TABLE.questClaim}) · boss kill ({FXP_TABLE.bossKill})</div>
          </div>
        )}

        {/* JOIN / SWITCH */}
        {factionSubTab === "join" && (
          <div>
            {!canSwitch && <div className="dim mb-8" style={{color:"#ff5555"}}>⚠ Cooldown: {switchDays}d before you can switch factions.</div>}
            {Object.entries(FACTIONS).map(([id, f]) => {
              const isCurrentFaction = player.factionId === id;
              return (
                <div key={id} className={`faction-card ${isCurrentFaction?"selected":""} ${!canSwitch&&!isCurrentFaction?"locked":""}`}
                  style={{borderColor: isCurrentFaction ? f.color : "#555555"}}
                  onClick={() => canSwitch && !isCurrentFaction && handleJoinFaction(id)}>
                  <div style={{display:"flex",alignItems:"center",marginBottom:6}}>
                    <span className="faction-icon" style={{color:f.color}}>{f.icon}</span>
                    <span className="faction-name" style={{color:f.color}}>{f.name}</span>
                    {isCurrentFaction && <span className="faction-rank-badge" style={{borderColor:f.color,color:f.color,marginLeft:10}}>CURRENT</span>}
                  </div>
                  <div className="faction-tagline">"{f.tagline}"</div>
                  <div className="dim" style={{marginBottom:6}}>{f.desc}</div>
                  {f.bonuses.map((b,i) => <div key={i} className="faction-bonus">{b}</div>)}
                  {!isCurrentFaction && canSwitch && (
                    <button className="btn btn-sm btn-full mt-8" style={{borderColor:f.color,color:f.color}}
                      onClick={e=>{e.stopPropagation();handleJoinFaction(id);}}>
                      {hasFaction ? `DEFECT TO ${f.name}` : `JOIN ${f.name}`}
                    </button>
                  )}
                </div>
              );
            })}
            {hasFaction && canSwitch && (
              <button className="btn btn-danger btn-sm btn-full mt-8" onClick={handleLeaveFaction}>
                LEAVE FACTION (no cooldown penalty)
              </button>
            )}
          </div>
        )}

        {/* CREW CHAT */}
        {factionSubTab === "chat" && hasFaction && (
          <div>
            <div className="flex-between mb-8">
              <div className="dim" style={{color:currentFaction.color}}>{currentFaction.icon} {currentFaction.name} — ENCRYPTED CHANNEL</div>
              <button className="btn btn-sm" onClick={fetchFactionChat} disabled={factionChatLoading}>↻</button>
            </div>
            <div className="chat-feed">
              {factionChatLoading && factionChatMsgs.length===0 && <div className="dim" style={{textAlign:"center",padding:12}}>// Loading...</div>}
              {!factionChatLoading && factionChatMsgs.length===0 && <div className="dim" style={{textAlign:"center",padding:12}}>// No transmissions yet. Be first.</div>}
              {factionChatMsgs.map((msg,i) => {
                const isYou = msg.name===player.name && msg.cls===player.cls;
                const cls = CLASSES[msg.cls];
                const age = Date.now()-msg.ts;
                const ageStr = age<60000?"now":age<3600000?`${Math.floor(age/60000)}m`:age<86400000?`${Math.floor(age/3600000)}h`:`${Math.floor(age/86400000)}d`;
                return (
                  <div key={msg.id} className={`chat-msg ${isYou?"you":""}`}>
                    <span className="chat-meta">{ageStr}</span>
                    <span className="chat-handle clickable-name" style={{color:cls?.color||currentFaction.color}}
                      onClick={() => viewProfile(msg.name, msg.cls)}>{cls?.icon} {msg.name}</span>
                    <span className="dim" style={{marginRight:4}}>R{msg.level}</span>
                    <span className="chat-text">{msg.text}</span>
                  </div>
                );
              })}
            </div>
            <div className="chat-chars">{factionChatInput.length}/{CHAT_MAX_LEN}</div>
            <div className="chat-input-row">
              <textarea className="chat-input" placeholder="Transmit to crew..." value={factionChatInput} maxLength={CHAT_MAX_LEN} rows={1}
                onChange={e=>setFactionChatInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleFactionChat();}}}
                disabled={factionChatLoading||factionChatCooldown>0} />
              <button className="btn btn-sm" style={{borderColor:currentFaction.color,color:currentFaction.color,flexShrink:0}}
                onClick={handleFactionChat} disabled={!factionChatInput.trim()||factionChatLoading||factionChatCooldown>0}>
                {factionChatCooldown>0?`${factionChatCooldown}s`:"SEND"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLeaderboardTab = () => {
    const MEDALS = ["🥇","🥈","🥉"];
    const entries = lbData?.entries || [];
    const hall = lbData?.hall || [];
    const meta = lbData?.meta;
    const seasonStart = meta ? new Date(meta.seasonStart) : null;
    const seasonEnd = seasonStart ? new Date(seasonStart.getTime() + SEASON_MONTHS * 30 * 24 * 3600 * 1000) : null;
    const msLeft = seasonEnd ? seasonEnd - Date.now() : 0;
    const daysLeft = Math.max(0, Math.floor(msLeft / (1000 * 60 * 60 * 24)));

    return (
      <div>
        <div className="flex-between mb-8">
          <div>
            {meta && <span className="season-badge">SEASON {meta.season} · {daysLeft}d remaining</span>}
          </div>
          <div className="flex" style={{gap:8}}>
            <button className="btn btn-sm" onClick={fetchLeaderboard} disabled={lbLoading}>↻</button>
            <button className="btn btn-sm" onClick={() => handleSubmitScore(player)} disabled={scoreSubmitted}>
              {scoreSubmitted ? "✓ POSTED" : "POST SCORE"}
            </button>
          </div>
        </div>

        <div className="tabs" style={{marginBottom:10}}>
          <button className={`tab ${lbTab==="current"?"active":""}`} onClick={()=>setLbTab("current")}>THIS SEASON</button>
          <button className={`tab ${lbTab==="hall"?"active":""}`} onClick={()=>setLbTab("hall")}>HALL OF FAME</button>
          <button className={`tab ${lbTab==="runners"?"active":""}`} onClick={()=>setLbTab("runners")}>ALL RUNNERS</button>
        </div>

        {lbLoading && <div className="dim" style={{padding:20,textAlign:"center"}}>// Loading grid records...</div>}

        {!lbLoading && lbTab === "current" && (
          <div>
            {entries.length === 0 && <div className="dim" style={{padding:16,textAlign:"center"}}>// No runners on the board yet. Be the first.</div>}
            {entries.length > 0 && (
              <>
                <div className="lb-header">
                  <div>#</div><div>RUNNER</div><div style={{textAlign:"right"}}>SCORE</div>
                  <div style={{textAlign:"right"}}>RANK</div><div style={{textAlign:"right"}}>KILLS</div><div style={{textAlign:"right"}}>₡</div>
                </div>
                {entries.map((e, i) => {
                  const isYou = e.name === player.name && e.cls === player.cls;
                  const rowCls = isYou ? "lb-row you" : i===0?"lb-row gold":i===1?"lb-row silver":i===2?"lb-row bronze":"lb-row";
                  const cls = CLASSES[e.cls];
                  return (
                    <div key={i} className={rowCls}>
                      <div className="lb-rank">{i < 3 ? MEDALS[i] : i+1}</div>
                      <div className="lb-name clickable-name" style={{color: isYou ? "var(--green)" : cls?.color || "#aaaaaa"}}
                        onClick={() => viewProfile(e.name, e.cls)}>
                        {cls?.icon} {e.name}{isYou?" (you)":""}{e.bossDefeated?" ★":""}
                      </div>
                      <div className="lb-val" style={{color:"#cccccc"}}>{scoreValue(e).toLocaleString()}</div>
                      <div className="lb-val">{e.level}</div>
                      <div className="lb-val">{e.kills}</div>
                      <div className="lb-val" style={{color:"#ffff55"}}>₡{e.credits}</div>
                    </div>
                  );
                })}
                <div className="dim mt-8" style={{textAlign:"center"}}>★ = Megacorp AI defeated · Score = Boss(100k) + Rank(5k) + Kills(200) + Credits</div>
              </>
            )}
          </div>
        )}

        {!lbLoading && lbTab === "hall" && (
          <div>
            {hall.length === 0 && <div className="dim" style={{padding:16,textAlign:"center"}}>// No completed seasons yet. First reset in {daysLeft}d.</div>}
            {hall.map((season, si) => (
              <div key={si} className="hall-entry">
                <div className="hall-season">SEASON {season.season} — {season.date}</div>
                {season.winners.map((w, wi) => (
                  <div key={wi} className="hall-winner">
                    <span className="medal">{MEDALS[wi] || `${wi+1}.`}</span>
                    <span style={{color: CLASSES[w.cls]?.color}}>{CLASSES[w.cls]?.icon} {w.name}</span>
                    <span className="dim" style={{marginLeft:"auto"}}>Rank {w.level} · {w.kills} kills{w.bossDefeated?" ★":""}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {!lbLoading && lbTab === "runners" && (
          <div>
            <RunnersPanel player={player} onViewProfile={viewProfile} />
          </div>
        )}
      {/* LEADERBOARD TAB */}
        {refugeTab === "leaderboard" && (
          <div>
            <div className="dim mb-8">Current season standings. <span style={{cursor:"pointer",color:"#55ff55",fontSize:11}} onClick={fetchLeaderboard}>↻ REFRESH</span></div>
            {lbLoading && <div className="dim" style={{padding:20,textAlign:"center"}}>//  Loading...</div>}
            {!lbLoading && lbData && (
              <>
                <div className="lb-header">
                  <div>#</div><div>RUNNER</div>
                  <div style={{textAlign:"right"}}>SCORE</div>
                  <div style={{textAlign:"right"}}>LEVEL</div>
                  <div style={{textAlign:"right"}}>KILLS</div>
                </div>
                {(lbData.entries||[]).map((e,i) => {
                  const isYou = e.name === player.name && e.cls === player.cls;
                  const cls = CLASSES[e.cls];
                  return (
                    <div key={i} className={"lb-row"+(isYou?" you":i===0?" gold":i===1?" silver":i===2?" bronze":"")}>
                      <div className="lb-rank">{i<3?MEDALS[i]:i+1}</div>
                      <div className="lb-name clickable-name" style={{color:isYou?"#fff":cls?.color}} onClick={()=>viewProfile(e.name,e.cls)}>
                        {cls?.icon} {e.name}{isYou?" (you)":""}{e.bossDefeated?"★":""}
                      </div>
                      <div className="lb-val">{scoreVal(e)}</div>
                      <div className="lb-val">{e.level}</div>
                      <div className="lb-val">{e.kills}</div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* RUNNERS TAB */}
        {refugeTab === "runners" && (
          <div>
            <RunnersPanel player={player} onViewProfile={viewProfile} />
          </div>
        )}

      </div>
    );
  };

  const renderPvp = () => {
    if (!pvpTarget) return null;
    const cls = CLASSES[pvpTarget.cls];
    const isBounty = (player.bounties||[]).includes(pvpTarget.handle);
    return (
      <div>
        <Narration text={narration} loading={narLoading} />

        <div className="grid-2">
          <div className="panel">
            <div className="panel-title">// YOUR SYSTEM</div>
            <div style={{color:CLASSES[player.cls].color,fontFamily:"Orbitron",fontSize:13,marginBottom:8}}>{player.name}</div>
            <StatBar label="INTEGRITY" value={player.hp} max={player.maxHp} type="hp" />
            <div className="dim">ATK:{calcAtk(player)} DEF:{calcDef(player)}</div>
          </div>
          <div className="enemy-card">
            <div className="enemy-name" style={{color:cls.color}}>
              {cls.icon} {pvpTarget.handle}
              {isBounty && <span className="boss-tag" style={{background:"#ffff55",color:"#000"}}>BOUNTY</span>}
            </div>
            <StatBar label="INTEGRITY" value={pvpTarget.hp} max={pvpTarget.maxHp} type="hp" />
            <div className="dim">ATK:{pvpTarget.atk} DEF:{pvpTarget.def} RANK:{pvpTarget.level}</div>
            <div className="dim mt-8" style={{fontStyle:"italic"}}>"{pvpTarget.taunt}"</div>
          </div>
        </div>

        {pvpOutcome && (
          <div className={`pvp-result ${pvpOutcome}`}>
            <div style={{fontFamily:"Orbitron",fontSize:13,marginBottom:8}}>
              {pvpOutcome === "win" ? `◈ FLATLINED — ₡${pvpLoot} LOOTED` : "◆ FLATLINED BY TARGET — BOUNTY PLACED"}
            </div>
            <div className="pvp-log">
              {pvpLog.map((l,i) => <div key={i} className={l.type}>&gt; {l.text}</div>)}
            </div>
          </div>
        )}

        {!pvpOutcome ? (
          <div className="grid-2" style={{gap:8}}>
            <button className="btn btn-danger btn-full" onClick={handlePvpFight} disabled={narLoading}>
              ◆ INITIATE ATTACK
            </button>
            <button className="btn btn-full" onClick={() => { setScreen("hub"); setTab("world_rivals"); }} disabled={narLoading}>
              ◇ BACK DOWN
            </button>
          </div>
        ) : (
          <button className="btn btn-full" onClick={() => { setScreen("hub"); setTab("world_rivals"); }}>
            ← BACK TO HIT LIST
          </button>
        )}
      </div>
    );
  };

  const renderEvent = () => {
    if (!activeEvent) return null;
    const typeColor = activeEvent.type === "windfall" ? "var(--green)" : activeEvent.type === "trap" ? "#ff55ff" : "var(--cyan)";
    const tagClass = `event-tag-${activeEvent.type}`;
    return (
      <div>
        <Narration text={narration} loading={narLoading} />

        <div className="event-card" style={{ borderColor: typeColor, background: `${typeColor}08` }}>
          <div className="event-type">{activeEvent.type === "windfall" ? "// DISCOVERY" : activeEvent.type === "trap" ? "// DANGER" : "// ENCOUNTER"}</div>
          <div className="event-icon">{activeEvent.icon}</div>
          <div className="event-label" style={{ color: typeColor }}>{activeEvent.label}</div>

          {/* Choices — shown before resolution */}
          {!eventResolved && (
            <div className="event-choices">
              {activeEvent.choices.map(c => (
                <button key={c.id}
                  className={`btn btn-full ${activeEvent.type === "trap" ? "btn-danger" : activeEvent.type === "windfall" ? "" : "btn-cyan"}`}
                  disabled={narLoading}
                  onClick={() => handleEventChoice(c.id)}>
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {/* Result — shown after resolution */}
          {eventResolved && (
            <div className={`event-result ${tagClass}`}>
              <div className="event-result-label">// OUTCOME</div>
              <div style={{ fontSize: 16, fontFamily: "Orbitron, sans-serif", letterSpacing: ".1em" }}>{eventDetail}</div>
            </div>
          )}
        </div>

        {/* Player quick-stats during event */}
        <div className="panel">
          <div className="flex-between">
            <span className="dim">INTEGRITY: <span style={{ color: "var(--green)" }}>{player.hp}/{player.maxHp}</span></span>
            <span className="dim">CREDITS: <span className="credits">₡{player.credits}</span></span>
            <span className="dim">RANK: <span style={{ color: "var(--green)" }}>{player.level}</span></span>
          </div>
          <StatusChips statuses={player.statusEffects} buff={player.nextFightBuff} />
        </div>

        {eventResolved && (
          <button className="btn btn-full btn-danger" onClick={handleEventContinue} disabled={narLoading}>
            ◆ CONTINUE INTO THE GRID
          </button>
        )}
      </div>
    );
  };

  const renderDungeon = () => {
    if (!activeDungeon) return null;
    const room = activeDungeon.rooms[dungeonRoom];
    const isBossRoom = room.boss;
    const dColor = activeDungeon.color;
    const totalLoot = dungeonLoot.reduce((s,l) => ({ credits: s.credits+l.credits, xp: s.xp+l.xp }), { credits:0, xp:0 });
    const isComplete = dungeonPhase === "complete";
    const isFailed   = dungeonPhase === "failed";

    return (
      <div className="dungeon-screen">
        <Narration text={narration} loading={narLoading} />

        {/* Dungeon header */}
        <div className="dungeon-header" style={{borderColor: dColor}}>
          <div className="flex-between">
            <span className="dungeon-room-title" style={{color: dColor}}>{activeDungeon.icon} {activeDungeon.name}</span>
            <span className="dim">HP: <span style={{color: player.hp < player.maxHp*0.3 ? "#ff5555" : "#55ff55"}}>{player.hp}/{player.maxHp}</span></span>
          </div>
          <div className="dim" style={{marginTop:4}}>{isComplete ? "DUNGEON COMPLETE" : isFailed ? "FLATLINED" : `Room ${dungeonRoom+1} of ${activeDungeon.rooms.length}: ${room.name}${isBossRoom?" — BOSS":""}`}</div>
          {/* Progress pips */}
          <div className="dungeon-progress">
            {activeDungeon.rooms.map((r,i) => (
              <div key={i} className={`dungeon-pip ${i<dungeonRoom||(isComplete)?"done":i===dungeonRoom&&!isFailed?"active":""} ${r.boss?"boss":""}`}
                style={{borderColor: i<dungeonRoom||(isComplete) ? dColor : r.boss?"#ff5555":"#555"}}>
                {r.boss ? "B" : i+1}
              </div>
            ))}
            <span className="dim" style={{marginLeft:6,fontSize:12}}>Cached: <span style={{color:"#ffff55"}}>₡{totalLoot.credits}</span> <span style={{color:"#55ffff"}}>{totalLoot.xp}XP</span></span>
          </div>
        </div>

        {/* Dungeon log */}
        {dungeonLog.length > 0 && (
          <div className="dungeon-log">
            {dungeonLog.map((l,i) => <div key={i} className={l.type||""}>&gt; {l.text}</div>)}
          </div>
        )}

        {/* Complete state */}
        {isComplete && (
          <div className="dungeon-complete" style={{borderColor: dColor, background:`${dColor}08`}}>
            <div className="dungeon-complete-title" style={{color: dColor}}>★ {activeDungeon.name} CLEARED ★</div>
            <div className="dungeon-loot-list">
              <div className="loot-credit">₡{totalLoot.credits} credits</div>
              <div className="loot-xp">+{totalLoot.xp} XP</div>
              {dungeonLoot.filter(l=>l.item).map((l,i) => (
                <div key={i} className="loot-item">{CONSUMABLES[l.item]?.icon} {CONSUMABLES[l.item]?.name}</div>
              ))}
            </div>
            <div className="dungeon-title-badge" style={{borderColor:dColor,color:dColor}}>[{activeDungeon.titleReward}]</div>
            <div className="dim" style={{marginTop:8,fontSize:13}}>Title earned and added to your profile.</div>
            <button className="btn btn-full mt-12" style={{borderColor:dColor,color:dColor}} onClick={handleDungeonCollect}>
              [C] COLLECT LOOT & EXIT
            </button>
          </div>
        )}

        {/* Failed state */}
        {isFailed && (
          <div className="dungeon-complete" style={{borderColor:"#ff5555",background:"rgba(255,85,85,.04)"}}>
            <div className="dungeon-complete-title" style={{color:"#ff5555"}}>◆ FLATLINED IN {activeDungeon.name}</div>
            <div className="dim" style={{marginTop:8}}>All cached loot lost. HP severely damaged.</div>
            <button className="btn btn-danger btn-full mt-12" onClick={() => { setActiveDungeon(null); setDungeonPhase("idle"); setScreen("hub"); }}>
              ← JACK OUT (DEFEATED)
            </button>
          </div>
        )}

        {/* Active combat phase */}
        {dungeonPhase === "combat" && !isComplete && !isFailed && (
          <div>
            <div className="enemy-card" style={{marginBottom:10}}>
              <div className="enemy-name" style={{color: isBossRoom?"#ff5555":dColor}}>
                {room.name}{isBossRoom && <span className="boss-tag">BOSS</span>}
              </div>
              <div className="dim" style={{fontSize:13}}>Threat level: {room.enemyLevel} · {isBossRoom?"Guaranteed loot drop":"Random loot chance"}</div>
            </div>
            <div className="grid-2" style={{gap:8}}>
              <button className="btn btn-full" style={{borderColor:dColor,color:dColor}} onClick={handleDungeonFight} disabled={narLoading}>
                {isBossRoom ? "[F] FIGHT BOSS" : "[F] CLEAR ROOM"}
              </button>
              <button className="btn btn-danger btn-full" onClick={handleDungeonFlee} disabled={narLoading}>
                ◇ FLEE (lose loot)
              </button>
            </div>
          </div>
        )}

        {/* Between rooms */}
        {dungeonPhase === "result" && (
          <div>
            <div className="dim mb-8" style={{lineHeight:1.6}}>
              Room cleared. HP: <span style={{color: player.hp < player.maxHp*0.3?"#ff5555":"#55ff55"}}>{player.hp}/{player.maxHp}</span> · No healing between rooms.
            </div>
            <div className="grid-2" style={{gap:8}}>
              <button className="btn btn-full" style={{borderColor:dColor,color:dColor}} onClick={handleDungeonNextRoom} disabled={narLoading}>
              [N] NEXT ROOM
              </button>
              <button className="btn btn-danger btn-full" onClick={handleDungeonFlee} disabled={narLoading}>
                ◇ FLEE (keep nothing)
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderVictory = () => (
    <div style={{ textAlign:"center", padding:"40px 0" }}>
      <div style={{ fontFamily:"Orbitron", fontSize:28, color:"var(--green)", marginBottom:16, textShadow:"0 0 30px var(--green)" }}>
        MEGACORP MAINFRAME CRACKED
      </div>
      <Narration text={narration} loading={narLoading} />
      <p className="dim" style={{ margin:"20px 0" }}>
        {player?.name} — Rank {player?.level} — {player?.kills} kills — ₡{player?.credits}
      </p>
      <p style={{fontSize:13, color:"#00aa00", marginBottom:20}}>
        {scoreSubmitted ? "✓ Score posted to leaderboard" : "Score submitted automatically"}
      </p>
      <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
        <button className="btn" onClick={() => { setScreen("hub"); setTab("world_leaderboard"); fetchLeaderboard(); setNarration("Legend of the grid. They'll write your handle in corrupted memory."); }}>
          ◈ SEE LEADERBOARD
        </button>
        <button className="btn btn-cyan" onClick={() => { setScreen("hub"); setNarration("Legend. The grid still needs you."); }}>
          ◇ KEEP RUNNING
        </button>
      </div>
    </div>
  );

  return (
    <>
      <style>{CSS}</style>
      {showIntro && <AnsiIntroScreen onDone={() => {
        try { sessionStorage.setItem("netrunner_intro_seen", "1"); } catch {}
        setShowIntro(false);
      }} />}
      <div className="crt" tabIndex={-1} style={{outline:'none'}}>
        <div className="app">
          <header className="header" style={{display: screen === "title" || screen === "auth" ? "none" : "block"}}>
            <pre className="ansi-title" style={{color:"#55ff55"}}>{`██████  ██▓  ▄████ ▄▄▄█████▓▓█████  ██▀███   ███▄ ▄███▓
▒██    ▒ ▓██▒ ██▒ ▀█▒▓  ██▒ ▓▒▓██   ▀ ▓██ ▒ ██▒▓██▒▀█▀ ██▒
░ ▓██▄   ▒██▒▒██░▄▄▄░▒ ▓██░ ▒░▒███   ▓██ ░▄█ ▒▓██    ▓██░
  ▒   ██▒░██░░▓██  ██▓░ ▓██▓ ░ ▒▓██  ▄ ▒██▀▀█▄  ▒██    ▒██ 
▒██████▒▒░██░░▒▓███▀▒  ▒██▒ ░ ░▒████▒░███▓ ▒██▒▒██▒   ░██▒
▒ ▒▓▒ ▒ ░░▓   ░▒   ▒   ▒ ░░░   ░░ ▒░ ░░░▒ ░░ ▒▓ ░▒▓░░▒ ▒░   ░  ░
░ ░▒  ░ ░ ▒ ░  ░   ░     ░     ░ ░  ░  ░▒ ░ ▒░░  ░      ░
░  ░  ░   ▒ ░░▒ ░   ░   ░         ░     ░░   ░ ░      ░   
      ░   ░        ░             ░  ░   ░            ░`}
            </pre>
            <div style={{color:"#888888",fontSize:13,letterSpacing:".2em",marginTop:4}}>
              {"=".repeat(60)}
            </div>
            <div style={{color:"#55ffff",fontSize:13,letterSpacing:".15em",marginTop:3}}>
              [ SIGTERM ] [ v1.2 ] [ THEY BUILT THE GRID. WE OWN IT. ]
            </div>
            <div style={{color:"#888888",fontSize:13,letterSpacing:".2em",marginTop:2}}>
              {"=".repeat(60)}
            </div>
          </header>
          {screen === "title"   && renderTitle()}
          {screen === "auth"    && renderAuth()}
          {screen === "create"  && renderCreate()}
          {screen === "hub"     && player && renderHub()}
          {screen === "pvp"     && player && renderPvp()}
          {screen === "event"   && player && renderEvent()}
          {screen === "dungeon" && player && renderDungeon()}
          {screen === "combat"  && player && renderCombat()}
          {screen === "victory" && player && renderVictory()}
        </div>
      </div>
      {/* Profile modal renders above everything */}
      {profileTarget && player && renderProfileModal()}
      {/* Attack log shows on login if you were raided */}
      {attackLog.length > 0 && player && renderAttackLog()}
      {/* First-time onboarding for new players */}
      {showOnboarding && player && renderOnboarding()}
      {/* Sponsor / intervention transmissions */}
      {transmission && player && renderTransmission()}
      {helpScreen && renderHelp()}
      {killScreen && renderKillScreen()}
      {achievementQueue.length > 0 && renderAchievementToast()}
    </>
  );
}
