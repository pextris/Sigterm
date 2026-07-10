![SIGTERM](http://alpha.blipsandbloops.com:3000/images/npcs/sigterm_logo_web.png)

# SIGTERM

> They built it. We broke in. Now we live here.

A free, open source, browser-based multiplayer RPG inspired by BBS door games of the 1980s. No install required to play. Real players. Play for 10 minutes or lose an entire evening.

**[Play now at alpha.blipsandbloops.com:3000](http://alpha.blipsandbloops.com:3000)**
**[Join the Discord](https://discord.gg/DUnGQkhfu)**

---

## The World

The Penley-Morrison Corporation owns the internet. 94% of it anyway. The other 6% is yours.

![Catherine](http://alpha.blipsandbloops.com:3000/images/npcs/catherine_web.png)

A network technician named Catherine got laid off at 3:47 AM via automated email. She jacked in angry. She never logged out. Nobody knows what she found. The Megacorp AI has been looking for her signal every 0.003 seconds for three million years. Dave from IT closed all the tickets as User Error.

---

## The Neon Refuge

![Lyra](http://alpha.blipsandbloops.com:3000/images/npcs/lyra_fill_web.png)

There's a bar in the 6%. The bartender is called Lyra. She's been there three million years. She remembers your order. She knows things she shouldn't.

---

## How It Works

**The Grid** — Jack in every day. Fight corp programs. Earn credits. Level up. You get 10 turns daily. Use them fast or take your time — the grid doesn't care. Come back tomorrow for more.

**Daily Missions** — Three missions every day. Complete them for bonus credits and XP. They reset at midnight. Miss them and they're gone.

**OffOps** — Multi-floor strikes against corp infrastructure. HP carries between floors. Die and lose everything. Clear the boss and keep it all. High risk. High reward.

**Stats that matter** — Kills. Credits. Level. Login streak. PvP record. Achievements. Every runner has a profile. Every profile tells a story.

**The Leaderboard** — One global leaderboard. Real players. Real competition. Your score is your legacy.

**The Public Vault** — A transparent credit pool that fills all season from player activity. When the season ends it pays out. Everyone can see it. Nobody can just take it.

**The Season** — No timer. The season ends when a runner defeats the Megacorp AI — which gets harder every time someone fails. The runner who ends it is written into the Archive permanently.

**Factions** — Join Deadlock, Cipher Syndicate, or Ghost Protocol. Each has its own ideology, playstyle, and rewards. Faction wars happen. Sides matter.

**Achievements** — 36 achievements with genuine humor and real rewards. From your first kill to defeating the Megacorp AI. Some are secret.

**The Archive** — A living lore document that unlocks as you progress. Corp memos. Faction histories. A signal in the Dead Drop that some runners have noticed and most haven't.

---

**The corp built the grid. Come take your piece.**

**[Jack in now](http://alpha.blipsandbloops.com:3000)**

---

## Quick Install

   git clone https://github.com/pextris/Sigterm.git
   cd Sigterm
   bash install.sh

The installer asks your node name, port, Anthropic API key (optional), and admin password. That is it. Your node is live.

---

## The Stack

- Backend: Node.js, Express
- Database: SQLite via better-sqlite3
- Frontend: React (Vite)
- Process manager: PM2
- Auth: JWT

---

## Manual Install

   git clone https://github.com/pextris/Sigterm.git
   cd Sigterm
   npm install
   cd client && npm install && npm run build && cd ..
   cp .env.example .env
   pm2 start server/index.js --name sigterm
   pm2 save

## Environment Variables

   NODE_NAME=YOUR-NODE-NAME
   PORT=3000
   JWT_SECRET=your_secret_here
   ANTHROPIC_API_KEY=your_key_here
   ADMIN_PASSWORD=your_admin_password
   NODE_ENV=production

---

## Roadmap

v1.2 The Rebrand - Live
v1.3 Fix and Deepen - In progress
v1.4 The Network - Planned
v1.5 The BBS - Planned (SKYCRZR said so)
v1.6 Public Launch - Planned

---

## Contributing

Bug reports, feature requests, pull requests all welcome. Open an issue first. ANSI artists and BBS sysops especially needed.

---

## License

MIT. Run your own grid. Own your own piece of the resistance.

---

## Credits

Built by pextris. Beta tested by SKYCRZR. Narration powered by Claude (Anthropic). Inspired by LORD (1989), Hackers (1995), Pi (1998), Red Dwarf, and The IT Crowd.

---

## Beta Testing

Join the Discord for beta testing and feedback:

**[Join the SIGTERM Discord](https://discord.gg/DUnGQkhfu)**

The grid is still there.
