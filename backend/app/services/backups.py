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


_STAMP = re.compile(r"(\d{8}T\d{6}Z)")


def list_backups(directory: Path | None = None) -> list[Backup]:
    """Every `.sql` file in the backups folder (nightly, pre-migrate, pre-restore, uploaded), newest first.

    The date is the stamp in the name; a file without one falls back to its modified time. Temp files
    (`.tmp`), dot-files and the lock file are not listed.
    """
    directory = directory if directory is not None else backup_dir()
    try:
        entries = list(directory.iterdir())
    except OSError:
        return []
    found = []
    for entry in entries:
        if entry.name.startswith(".") or not entry.name.endswith(".sql") or not entry.is_file():
            continue
        taken_at = None
        match = _STAMP.search(entry.name)
        if match:
            try:
                taken_at = datetime.strptime(match.group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            except ValueError:
                taken_at = None
        if taken_at is None:
            taken_at = datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc)  # provenance only
        found.append(Backup(name=entry.name, taken_at=taken_at, path=entry))
    return sorted(found, key=lambda b: (b.taken_at, b.name), reverse=True)


class UploadRefused(Exception):
    """The uploaded file cannot be added to the list. Message is shown to the user."""


async def add_uploaded_backup(chunks) -> Backup:
    """Add an uploaded file to the backups list as `uploaded-<UTC stamp>.sql`; it never restores anything.

    `chunks` is an async iterator of bytes (the raw request body). It is streamed to a dot-prefixed temp file,
    kept only if it carries the dump-complete marker, and linked into place without ever overwriting a file.
    The restore's own checks (shell escapes, schema) still run at restore time.
    """
    from app.restore import MARKER  # restore imports this module, so import it late

    directory = backup_dir()
    try:
        directory.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")  # file-name stamp, not business logic
        tmp = directory / f".uploaded-{stamp}-{os.getpid()}.tmp"
        final = directory / f"uploaded-{stamp}.sql"
        try:
            with open(tmp, "wb") as out:
                async for chunk in chunks:
                    out.write(chunk)
            complete = False
            with open(tmp, "rb") as check:
                marker = MARKER.encode()
                for line in check:
                    if line.startswith(marker):
                        complete = True
                        break
            if not complete:
                raise UploadRefused(f"That file was not added: it does not end with '{MARKER}', so it looks cut short.")
            try:
                os.link(tmp, final)  # fails rather than overwrite
            except FileExistsError:
                raise UploadRefused("That file was not added: another file was added in the same second. Try again.")
        finally:
            tmp.unlink(missing_ok=True)
    except OSError as exc:
        raise UploadRefused(f"That file was not added: {exc}")
    return Backup(name=final.name, taken_at=datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc), path=final)
