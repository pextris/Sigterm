![SIGTERM](http://alpha.blipsandbloops.com:3000/images/npcs/sigterm_logo_web.png)

# SIGTERM

![SIGTERM](http://alpha.blipsandbloops.com:3000/images/npcs/sigterm_logo_web.png)

> They built it. We broke in. Now we live here.

A free, open source, browser-based multiplayer RPG inspired by BBS door games of the 1980s. No install required to play. Real players. Play for 10 minutes or lose an entire evening.

**[Play now at alpha.blipsandbloops.com:3000](http://alpha.blipsandbloops.com:3000)**

---

## The World

The Penley-Morrison Corporation controls 94% of global network infrastructure. The other 6% belongs to the runners. You are one of them.

The first runner was named Yael. She jacked in angry at 4:15 AM and never logged out. Nobody knows what she found. The Megacorp AI has been looking for her signal every 0.003 seconds for three million years. Dave from IT closed all the tickets about it as User Error.


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

> The grid is still there.
>
> **alpha.blipsandbloops.com:3000**

---

## Beta Testing

We're actively looking for beta testers. Join the Discord:

**[Join the SIGTERM Discord](https://discord.gg/DUnGQkhfu)**

Report bugs, share feedback, and jack in with the crew.

---

## Beta Testing

We're actively looking for beta testers. Join the Discord:

**[Join the SIGTERM Discord](https://discord.gg/DUnGQkhfu)**

Report bugs, share feedback, and jack in with the crew.
