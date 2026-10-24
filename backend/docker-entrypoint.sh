#!/bin/sh
# Migrations run at container start, behind a dump. The app refuses to start if the database is newer than the code.
set -e
cd /app
python -m app.startup_check
if [ -n "$BACKUP_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${POSTGRES_HOST:-db}" -U "$POSTGRES_USER" "$POSTGRES_DB" > "$BACKUP_DIR/pre-migrate-$STAMP.sql" || echo "pg_dump failed (empty database?) — continuing"
fi
python -m app.upgrade
# Dev reloads on source changes; production (APP_ENV=production, set by docker-compose.prod.yml) does not.
if [ "$APP_ENV" = "production" ]; then
  exec uvicorn app.main:app --host 0.0.0.0 --port 8000
fi
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
