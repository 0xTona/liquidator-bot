#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Aave Liquidator Bot — Cloud Server Setup Script
# Run this on a fresh Debian/Ubuntu VM (Oracle Cloud, AWS, GCP, etc.)
# Usage: chmod +x setup.sh && ./setup.sh
# ──────────────────────────────────────────────────────────────────────────────

set -e

echo "═══════════════════════════════════════════════════════"
echo "  Aave Liquidator Bot — Server Setup"
echo "═══════════════════════════════════════════════════════"

# ── 1. Install Node.js 20 ────────────────────────────────────────────────────
if ! command -v node &> /dev/null; then
    echo "[1/5] Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "[1/5] Node.js already installed: $(node -v)"
fi

# ── 2. Install PM2 ───────────────────────────────────────────────────────────
if ! command -v pm2 &> /dev/null; then
    echo "[2/5] Installing PM2 (process manager)..."
    sudo npm install -g pm2
else
    echo "[2/5] PM2 already installed: $(pm2 -v)"
fi

# ── 3. Install dependencies ──────────────────────────────────────────────────
echo "[3/5] Installing project dependencies..."
npm install --production

# ── 4. Configure .env ────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    echo "[4/5] Creating .env file from template..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: You must edit .env with your actual values:"
    echo "    nano .env"
    echo ""
    echo "  Required:"
    echo "    PRIVATE_KEY       = your bot hot wallet private key"
    echo "    RPC_URL           = your RPC endpoint (e.g. Alchemy free tier)"
    echo "    LIQUIDATOR_CONTRACT_ADDRESS = your deployed contract address"
    echo ""
    read -p "Press Enter after you've edited .env, or Ctrl+C to do it later..."
else
    echo "[4/5] .env already exists, skipping."
fi

# ── 5. Start with PM2 ────────────────────────────────────────────────────────
echo "[5/5] Starting bot with PM2..."

# Stop existing instance if running
pm2 delete liquidator 2>/dev/null || true

# Start the bot
pm2 start src/bot.js --name "liquidator" --max-memory-restart 200M

# Save PM2 process list so it survives reboots
pm2 save

# Setup PM2 to auto-start on boot
echo ""
echo "Setting up auto-start on reboot..."
pm2 startup | tail -1 | bash 2>/dev/null || echo "Run the pm2 startup command above manually if needed."

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ✅ Bot is running!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Useful commands:"
echo "    pm2 logs liquidator     — view live logs"
echo "    pm2 status              — check if bot is running"
echo "    pm2 restart liquidator  — restart the bot"
echo "    pm2 stop liquidator     — stop the bot"
echo ""
