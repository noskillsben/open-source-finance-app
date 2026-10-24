"""Restore a backup: `python -m app.restore <file name>` (DESIGN.md § Architecture Overview ->
Backups are one mechanism).

The name is a file in the backups folder, never a path. Everything that can refuse does so before
the database is touched: a file that is missing, cut short, holds a psql shell escape, or holds a
schema this code does not know. Then, holding the same lock file as Back up now, the current data
is dumped as `pre-restore-<stamp>.sql` (the undo), the public schema is emptied and the file loaded
in ONE transaction (a failed load leaves the old data), and the steps a container start runs after
its dump (migrations, seed, data steps) bring an older backup up to the current schema.
"""
import fcntl
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.engine import make_url

from app import upgrade
from app.config import settings
from app.services.backups import LOCK_NAME, backup_dir
from app.startup_check import known_revisions

MARKER = "-- PostgreSQL database dump complete"
_COPY_START = re.compile(r"^COPY\s.*\sFROM stdin;\s*$")
_VERSION_COPY = re.compile(r"^COPY\s+(public\.)?alembic_version\s")
_ALLOWED_META = re.compile(r"^\\(restrict|unrestrict)(\s+\S+)?\s*$")  # pg_dump's own
_DROPPED = "SET transaction_timeout"  # older dumps carry it; the database refuses it


class RestoreRefused(Exception):
    pass


def _resolve(name: str) -> Path:
    directory = backup_dir()
    if not name or name != Path(name).name or "\\" in name or name in (".", ".."):
        raise RestoreRefused(f"Refusing: {name!r} is not a file name in the backups folder (no paths).")
    path = directory / name
    if not path.is_file():
        raise RestoreRefused(f"Refusing: there is no file {name} in the backups folder.")
    return path


def inspect_dump(path: Path) -> set[str]:
    """Check the file and return the alembic revision(s) it holds. Raises RestoreRefused."""
    complete = False
    in_copy = False
    in_version = False
    revisions: set[str] = set()
    with open(path, encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.rstrip("\r\n")
            if in_copy:
                if line == "\\.":
                    in_copy = in_version = False
                elif in_version:
                    revisions.add(line.split("\t")[0])
                continue
            if _COPY_START.match(line):
                in_copy = True
                in_version = bool(_VERSION_COPY.match(line))
                continue
            if line.startswith(MARKER):
                complete = True
            stripped = line.lstrip()
            if stripped.startswith("\\") and not _ALLOWED_META.match(stripped):
                raise RestoreRefused("Refusing: the file holds a psql command (a line starting with a "
                                     "backslash), which a backup never does.")
    if not complete:
        raise RestoreRefused(f"Refusing: {path.name} does not end with '{MARKER}'; it was cut short.")
    if not revisions:
        raise RestoreRefused(f"Refusing: {path.name} holds no alembic_version, so it is not a backup of this app.")
    unknown = revisions - known_revisions()
    if unknown:
        raise RestoreRefused(f"Refusing: {path.name} holds a newer schema (revision {sorted(unknown)}) than "
                             "this app knows. Update the app first, then restore.")
    return revisions


def _conn():
    url = make_url(settings.database_url)
    args = ["-h", url.host or "db", "-p", str(url.port or 5432), "-U", url.username]
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    return args, url.database, env


def _dump_current(directory: Path) -> Path:
    args, database, env = _conn()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")  # file name provenance, not a business date
    tmp = directory / f".pre-restore-{stamp}.tmp"
    final = directory / f"pre-restore-{stamp}.sql"
    try:
        with open(tmp, "wb") as out:
            result = subprocess.run(["pg_dump", *args, database], stdout=out, stderr=subprocess.PIPE, env=env)
        ok = result.returncode == 0 and MARKER in tmp.read_text(encoding="utf-8", errors="replace")
        if not ok:
            raise RestoreRefused("Stopped: could not take a backup of the current data first "
                                 f"({result.stderr.decode(errors='replace').strip() or 'incomplete dump'}). "
                                 "Nothing was changed.")
        tmp.rename(final)
    finally:
        tmp.unlink(missing_ok=True)
    return final


def _load(path: Path) -> None:
    args, database, env = _conn()
    proc = subprocess.Popen(
        ["psql", "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", *args, database],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    err = b""
    try:
        proc.stdin.write(b"DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n")
        with open(path, "rb") as handle:
            for line in handle:
                if not line.startswith(_DROPPED.encode()):
                    proc.stdin.write(line)
        proc.stdin.close()
    except BrokenPipeError:
        pass
    err = proc.stderr.read()
    if proc.wait() != 0:
        raise RestoreRefused(f"The load failed and was rolled back, so your data is as it was: "
                             f"{err.decode(errors='replace').strip()}")


def restore(name: str) -> Path:
    path = _resolve(name)
    inspect_dump(path)
    directory = backup_dir()
    try:
        lock = open(directory / LOCK_NAME, "a")
    except OSError as exc:
        raise RestoreRefused(f"Refusing: cannot open the backups folder lock: {exc}")
    with lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RestoreRefused("Refusing: a backup or restore is already running. Nothing was changed.")
        undo = _dump_current(directory)
        print(f"saved the current data as {undo.name} (restore that file to undo)")
        _load(path)
        print(f"loaded {path.name}")
        upgrade.run()
    return undo


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m app.restore <file name in the backups folder>", file=sys.stderr)
        return 2
    try:
        restore(argv[0])
    except RestoreRefused as exc:
        print(exc, file=sys.stderr)
        return 1
    print("restore complete. Start the app and check your balances and Data check.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
