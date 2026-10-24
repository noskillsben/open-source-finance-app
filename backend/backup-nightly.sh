#!/bin/sh
# Nightly pg_dump into $BACKUP_DIR as nightly-<UTC stamp>.sql, keeping the newest $KEEP (default 14).
# "backup-nightly.sh once" takes one backup and exits; with no argument it loops, running at 03:00 UTC.
# When the database holds no transactions while nightly-* backups exist, nothing is written or pruned and the
# script exits $SKIP_CODE (DESIGN.md, Backups are one mechanism): an empty dump must not push real ones out.
# A dump is accepted only if it ends with Postgres's completion marker. Only nightly-* files are ever pruned.
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP="${KEEP:-14}"
MARKER='-- PostgreSQL database dump complete'
SKIP_CODE=3

# Exit status: 0 the database has transactions, 1 it has none, 2 the check could not run.
db_has_transactions() {
  q() { PGPASSWORD="$POSTGRES_PASSWORD" psql -h "${POSTGRES_HOST:-db}" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "$1"; }
  exists=$(q "SELECT to_regclass('public.\"transaction\"') IS NOT NULL") || return 2
  [ "$exists" = "t" ] || { [ "$exists" = "f" ] && return 1; return 2; }
  rows=$(q 'SELECT EXISTS (SELECT 1 FROM "transaction")') || return 2
  [ "$rows" = "t" ] && return 0
  [ "$rows" = "f" ] && return 1
  return 2
}

run_once() {
  mkdir -p "$BACKUP_DIR" || return 1
  if ls -1 "$BACKUP_DIR" | grep -q '^nightly-.*\.sql$'; then
    db_has_transactions
    case $? in
      0) ;;
      1) echo "No backup taken: the database is empty while backups exist, and an empty backup would push a real one out. Nothing was written or deleted. See the Backups section of the user guide (docs/user/README.md)." >&2
         return "$SKIP_CODE" ;;
      *) echo "backup FAILED: could not check whether the database holds data; earlier backups left alone" >&2
         return 1 ;;
    esac
  fi
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  tmp="$BACKUP_DIR/.nightly-$stamp.tmp"
  final="$BACKUP_DIR/nightly-$stamp.sql"
  if PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h "${POSTGRES_HOST:-db}" -U "$POSTGRES_USER" "$POSTGRES_DB" > "$tmp" \
     && grep -q -e "$MARKER" "$tmp"; then
    mv "$tmp" "$final"
    echo "backup written: $final"
  else
    rm -f "$tmp"
    echo "backup FAILED: pg_dump errored or the dump was incomplete; earlier backups left alone" >&2
    return 1
  fi
  # Names sort by stamp, so everything after the newest $KEEP is the oldest.
  ls -1 "$BACKUP_DIR" | grep '^nightly-.*\.sql$' | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$BACKUP_DIR/$old" && echo "pruned: $old"
  done
  return 0
}

if [ "$1" = "once" ]; then
  run_once
  exit $?
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "today 03:00" +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow 03:00" +%s)
  echo "next backup at $(date -u -d "@$next" +%Y-%m-%dT%H:%M:%SZ)"
  sleep "$((next - now))"
  run_once || true
done
