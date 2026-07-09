#!/bin/bash
# ─────────────────────────────────────────────────────────────
# NETRUNNER — Linux Install Script
# Tested on Ubuntu 20.04 / 22.04 / Debian 11+
# Run as root or with sudo
# ─────────────────────────────────────────────────────────────

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[NETRUNNER]${NC} $1"; }
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   NETRUNNER — Installation Script        ║"
echo "  ║   Cyberpunk BBS Door Game                ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── CHECK ROOT ──────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  warn "Not running as root. Some steps may fail."
  warn "Re-run with: sudo bash install.sh"
fi

# ── DETECT INSTALL DIR ──────────────────────────────────────
INSTALL_DIR="${NETRUNNER_DIR:-/var/www/netrunner}"
log "Installing to: $INSTALL_DIR"

# ── INSTALL NODE.JS 18+ ─────────────────────────────────────
log "Checking Node.js..."
if command -v node &> /dev/null; then
  NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)) < 18 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "old")
  if [ "$NODE_VER" = "ok" ]; then
    info "Node.js $(node --version) already installed."
  else
    warn "Node.js $(node --version) is too old. Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
else
  log "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
info "Node.js $(node --version) / npm $(npm --version)"

# ── INSTALL PM2 ─────────────────────────────────────────────
log "Installing PM2 process manager..."
npm install -g pm2 2>/dev/null || warn "PM2 install failed — you can still run manually"

# ── CREATE INSTALL DIR ───────────────────────────────────────
log "Setting up install directory..."
mkdir -p "$INSTALL_DIR"
cp -r . "$INSTALL_DIR/" 2>/dev/null || true

cd "$INSTALL_DIR"

# ── INSTALL SERVER DEPENDENCIES ─────────────────────────────
log "Installing server dependencies..."
cd server
npm install --production
cd ..

# ── SET UP ENVIRONMENT FILES ────────────────────────────────
log "Setting up environment files..."

if [ ! -f server/.env ]; then
  cp server/.env.example server/.env
  # Generate a random JWT secret
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
  sed -i "s/change-this-to-a-long-random-string/$JWT_SECRET/" server/.env
  log "Created server/.env with random JWT secret"
  warn "You MUST add your ANTHROPIC_API_KEY to server/.env before starting"
else
  info "server/.env already exists — skipping"
fi

if [ ! -f client/.env ]; then
  cp client/.env.example client/.env
  info "Created client/.env — set VITE_API_URL if building for a custom domain"
fi

# ── BUILD FRONTEND ───────────────────────────────────────────
log "Installing client dependencies and building frontend..."
cd client
npm install
npm run build
cd ..
log "Frontend built to server/public/"

# ── PM2 SETUP ───────────────────────────────────────────────
log "Setting up PM2..."
pm2 delete netrunner 2>/dev/null || true
pm2 start server/index.js \
  --name netrunner \
  --cwd "$INSTALL_DIR" \
  --log "$INSTALL_DIR/logs/netrunner.log" \
  --time \
  --restart-delay 3000 \
  --max-restarts 10

pm2 save
pm2 startup 2>/dev/null | grep "sudo" | bash 2>/dev/null || warn "Could not set PM2 startup — run 'pm2 startup' manually"

mkdir -p "$INSTALL_DIR/logs"

# ── DONE ─────────────────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   INSTALLATION COMPLETE                  ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
info "Server running on port 3000"
info "Edit server/.env to set your ANTHROPIC_API_KEY"
info ""
info "Useful commands:"
info "  pm2 status           — check if running"
info "  pm2 logs netrunner   — view live logs"
info "  pm2 restart netrunner — restart after config changes"
info "  pm2 stop netrunner   — stop the server"
info ""
info "To run without PM2:"
info "  cd $INSTALL_DIR && node server/index.js"
info ""
warn "Next step: Add ANTHROPIC_API_KEY to server/.env then restart"
info "  nano $INSTALL_DIR/server/.env"
info "  pm2 restart netrunner"
echo ""
