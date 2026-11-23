#!/usr/bin/env bash
set -e

cd /var/www/right-agent-group

echo ">>> Backing up environment file..."
cp .env /home/ubuntu/.env.live.bak

echo ">>> Configuring git repository..."
if [ ! -d ".git" ]; then
  git init
  git remote add origin https://github.com/arjungaming371-cmyk/right-agent-group.git
fi

git remote set-url origin https://github.com/arjungaming371-cmyk/right-agent-group.git
git fetch origin content-fixes-2026-11-13
git checkout -f -B content-fixes-2026-11-13 origin/content-fixes-2026-11-13

echo ">>> Restoring environment configuration..."
cp /home/ubuntu/.env.live.bak .env
sed -i 's|NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=https://13.201.0.111.sslip.io|g' .env

echo ">>> Running database migration..."
sudo -u postgres psql right_agent_group -f migrations/2026-11-13_transparency.sql

echo ">>> Installing dependencies..."
npm install

echo ">>> Building Next.js production bundle..."
export NODE_OPTIONS='--max-old-space-size=1536'
npm run build

echo ">>> Updating Nginx config if needed..."
if [ -f "scripts/nginx-lightsail.conf" ]; then
  sudo cp scripts/nginx-lightsail.conf /etc/nginx/sites-available/rightagent
  sudo nginx -t && sudo systemctl reload nginx || true
fi

echo ">>> Restarting PM2 application..."
pm2 restart all --update-env

echo ">>> UPDATE_SUCCESSFUL"
