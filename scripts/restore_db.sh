#!/usr/bin/env bash
set -e
chmod 755 /home/ubuntu
chmod 644 /home/ubuntu/db_backup.sql
sudo -u postgres createdb right_agent_group 2>/dev/null || true
sudo -u postgres psql -f /home/ubuntu/db_backup.sql right_agent_group > /dev/null
PG_PASS="${PG_PASSWORD:-ARJUNGAMING}"
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD '$PG_PASS';"
echo "DATABASE_MIGRATION_COMPLETE"
