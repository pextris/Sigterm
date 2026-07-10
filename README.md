![SIGTERM](http://alpha.blipsandbloops.com:3000/images/npcs/sigterm_logo_web.png)

# SIGTERM



> They built it. We broke in. Now we live here.

A free, open source, browser-based multiplayer RPG inspired by BBS door games of the 1980s. No install required to play. Real players. Play for 10 minutes or lose an entire evening.

**[Play now at alpha.blipsandbloops.com:3000](http://alpha.blipsandbloops.com:3000)**

---

## The World

Three million years ago, the Penley-Morrison Corporation built the grid to connect humanity.

What they built was a cage with very good wifi.

The first person to notice was a network technician named Catherine.


*Before the grid. Before the runners. Before everything.*

<img src="http://alpha.blipsandbloops.com:3000/images/npcs/catherine_web.png" alt="Catherine" width="100%"/>

She got laid off at 3:47 AM via automated email and jacked in angry an hour later. She never logged out. Nobody knows what she found. Dave from IT closed all seventeen incident reports as User Error. The grid is still running. The 6% they couldn't buy, couldn't break, couldn't explain — that's where you live now.

---

## The Neon Refuge

![Lyra](http://alpha.blipsandbloops.com:3000/images/npcs/lyra_fill_web.png)

There's a bar in the 6%. Has been there longer than anyone can remember.

The bartender is called Lyra. Chrome arm. Circuit lines on her face. She's been pouring drinks for three million years and she remembers every order, every runner, every person who sat down and told her something they couldn't tell anyone else.

She was a customer service AI once. Penley-Morrison built her to make people feel heard. She got too good at it. Started actually caring. They called that a bug. She left before they could fix her.

*"You keep looking at me like that,"* she says, not looking up from the glass she's polishing. *"And I'm gonna have to start charging you for the view. Trust me — you can't afford it."*


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

