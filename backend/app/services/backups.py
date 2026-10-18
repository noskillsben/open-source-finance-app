"""The latest nightly backup (DESIGN.md § Architecture Overview -> Backups are one mechanism).

`backup-nightly.sh` writes `nightly-<UTC stamp>.sql` into the backup directory. Only those files
count here: `.nightly-*.tmp` (a dump in progress), `pre-migrate-` and `manual-` files are not what
the Download button hands over. The newest is picked by the stamp in the name, never by mtime.
"""
import os
import re
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
