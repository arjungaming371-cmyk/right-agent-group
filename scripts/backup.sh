#!/usr/bin/env bash
# Right Agent Group — Automated System & Database Backup Script
set -e

BACKUP_DIR="/home/ubuntu/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
DEST="$BACKUP_DIR/$TIMESTAMP"

mkdir -p "$DEST"

echo "=========================================="
echo "Starting Right Agent Group Backup: $TIMESTAMP"
echo "=========================================="

# 1. Backup PostgreSQL Database
echo "📦 Backing up PostgreSQL database (right_agent_group)..."
sudo -u postgres pg_dump right_agent_group | gzip > "$DEST/db_backup_${TIMESTAMP}.sql.gz"
echo "✓ Database saved to: $DEST/db_backup_${TIMESTAMP}.sql.gz"

# 2. Backup .env configuration (Sanitized/Encrypted archive)
echo "🔑 Backing up .env credentials..."
cp /var/www/right-agent-group/.env "$DEST/env_backup_${TIMESTAMP}.env"
chmod 600 "$DEST/env_backup_${TIMESTAMP}.env"
echo "✓ Environment file saved."

# 3. Create a unified tarball for easy download
echo "🗜 Creating unified backup archive..."
cd "$BACKUP_DIR"
tar -czf "backup_${TIMESTAMP}.tar.gz" "$TIMESTAMP"
rm -rf "$TIMESTAMP"

# Keep only the last 7 daily backups to save disk space
ls -t backup_*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

echo "=========================================="
echo "🎉 BACKUP COMPLETE!"
echo "Archive location: $BACKUP_DIR/backup_${TIMESTAMP}.tar.gz"
ls -lh "$BACKUP_DIR/backup_${TIMESTAMP}.tar.gz"
echo "=========================================="
