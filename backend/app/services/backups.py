"""The latest nightly backup (DESIGN.md § Architecture Overview -> Backups are one mechanism).

`backup-nightly.sh` writes `nightly-<UTC stamp>.sql` into the backup directory. Only those files
count here: `.nightly-*.tmp` (a dump in progress) and `pre-migrate-` files are not what
the Download button hands over. The newest is picked by the stamp in the name, never by mtime.
"""
import fcntl
import os
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

_NAME = re.compile(r"^nightly-(\d{8}T\d{6}Z)\.sql$")


@dataclass(frozen=True)
class Backup:
    name: str
    taken_at: datetime  # UTC, parsed from the stamp in the name
    path: Path


def backup_dir() -> Path:
    return Path(os.environ.get("BACKUP_DIR", "/backups"))


def restore_command(name: str) -> str:
    """The one command that restores `name` (a file in the backups folder) with the app down."""
    prod = " -f docker-compose.prod.yml" if os.environ.get("APP_ENV") == "production" else ""
    return f"docker compose{prod} run --rm --entrypoint python backend -m app.restore {name}"


def latest_backup(directory: Path | None = None) -> Backup | None:
    """The newest nightly backup, or None when the directory is missing, empty or holds none."""
    directory = directory if directory is not None else backup_dir()
    try:
        entries = list(directory.iterdir())
    except OSError:
        return None
    found = []
    for entry in entries:
        match = _NAME.match(entry.name)
        if not match or not entry.is_file():
            continue
        try:
            taken_at = datetime.strptime(match.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        found.append(Backup(name=entry.name, taken_at=taken_at, path=entry))
    return max(found, key=lambda b: b.taken_at, default=None)


SCRIPT = Path(__file__).resolve().parents[2] / "backup-nightly.sh"
LOCK_NAME = ".backup-now.lock"  # matches neither nightly-*.sql nor .nightly-*.tmp


class BackupBusy(Exception):
    pass


class BackupFailed(Exception):
    pass


class BackupSkipped(Exception):
    """The script declined to dump: the database is empty while nightly backups exist. Message is the script's."""


SKIP_CODE = 3  # matches SKIP_CODE in backup-nightly.sh


def take_backup_now() -> Backup | None:
    """Run `backup-nightly.sh once` and wait; the script does the dump, the completeness check and pruning.

    Run through `sh` because in dev ./backend is bind-mounted over /app and the exec bit is not guaranteed.
    A non-blocking flock keeps two requests from dumping at once; it is released when the process dies.
    """
    directory = backup_dir()
    try:
        directory.mkdir(parents=True, exist_ok=True)
        lock = open(directory / LOCK_NAME, "a")
    except OSError as exc:
        raise BackupFailed(f"Backup failed: {exc}. Earlier backups were left alone.")
    with lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise BackupBusy("A backup is already being taken.")
        result = subprocess.run(["sh", str(SCRIPT), "once"], capture_output=True, text=True, env=os.environ.copy())
    if result.returncode == SKIP_CODE:
        raise BackupSkipped(result.stderr.strip() or "No backup taken: the database is empty while backups exist.")
    if result.returncode != 0:
        lines = [line for line in result.stderr.strip().splitlines() if line.strip()]
        reason = f" ({lines[-1]})" if lines else ""
        raise BackupFailed(f"Backup failed{reason}. Earlier backups were left alone.")
    return latest_backup(directory)
