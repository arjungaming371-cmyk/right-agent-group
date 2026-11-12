#!/usr/bin/env bash
set -e

sudo mkdir -p /var/www
sudo chown -R ubuntu:ubuntu /var/www

echo "Extracting app to /var/www..."
tar -xzf /home/ubuntu/app_built.tar.gz -C /var/www/
sudo chown -R ubuntu:ubuntu /var/www/right-agent-group

cd /var/www/right-agent-group

echo "Installing node dependencies..."
npm install --omit=dev

echo "Updating .env with new domain https://13.201.0.111.sslip.io..."
sed -i 's|NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=https://13.201.0.111.sslip.io|g' .env

echo "APP_SETUP_COMPLETE"
