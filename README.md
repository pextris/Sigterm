# SIGTERM

> They built it. We broke in. Now we live here.

A free, open source, browser-based multiplayer RPG inspired by BBS door games of the 1980s. No install required to play. Real players. Play for 10 minutes or lose an entire evening.

Play now at: sigterm.blipsandbloops.com

## Quick Install

    git clone https://github.com/pextris/Sigterm.git
    cd Sigterm
    bash install.sh

The installer will ask you your node name, port, Anthropic API key (optional), and admin password. That is it. Your node is live.

## Manual Install

Requirements: Node.js 18+, npm, PM2 (npm install -g pm2)

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

## The Stack

- Backend: Node.js, Express
- Database: SQLite via better-sqlite3
- Frontend: React (Vite)
- Process manager: PM2
- Auth: JWT

## Deploy Updates

    cd Sigterm
    git pull
    cd client && npm run build && cd ..
    pm2 restart sigterm

## Admin Panel

Visit /backstage on your running node. Password protected via ADMIN_PASSWORD.

## The Lore

The first runner was named Yael. She got laid off at 3:47 AM via automated email and jacked into the grid an hour later. She never logged out. Nobody knows what she found. The Megacorp AI has been looking for her signal every 0.003 seconds for three million years. Dave from IT closed all the tickets about it as User Error. The grid is still running. Come take your piece.

## Roadmap

v1.2 The Rebrand - Live
v1.3 Fix and Deepen - In progress
v1.4 The Network - Planned
v1.5 The BBS - Planned (SKYCRZR said so)
v1.6 Public Launch - Planned

## Contributing

Bug reports, feature requests, pull requests all welcome. Open an issue first. ANSI artists and BBS sysops especially needed.

## License

MIT. Run your own grid. Own your own piece of the resistance.

## Credits

Built by pextris. Beta tested by SKYCRZR. Narration powered by Claude (Anthropic). Inspired by LORD (1989), Hackers (1995), Pi (1998), Red Dwarf, and The IT Crowd.

The grid is still there. sigterm.blipsandbloops.com
