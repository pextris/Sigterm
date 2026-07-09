# SIGTERM

> They built it. We broke in. Now we live here.

A free, open source, browser-based multiplayer RPG inspired by BBS door games of the 1980s. No install required to play. Real players. Self-host it yourself or play at sigterm.blipsandbloops.com.

## The World

The Penley-Morrison Corporation controls 94% of global network infrastructure. The other 6% belongs to the runners. You are one of them.

## The Stack

- Backend: Node.js, Express
- Database: SQLite via better-sqlite3
- Frontend: React (Vite)
- Process manager: PM2

## Quick Start

   git clone https://github.com/pextris/sigterm
   cd sigterm
   npm install
   cd client && npm install && npm run build && cd ..
   cp .env.example .env
   pm2 start server/index.js --name sigterm

## License

MIT - run your own grid.
