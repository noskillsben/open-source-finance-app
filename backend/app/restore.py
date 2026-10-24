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
_ALLOWED_META = re.compile(r"^\\(restrict|unrestrict) [A-Za-z0-9]+$")  # pg_dump's own
_OWNER = re.compile(  # pg_dump's one-line ownership statements; the equivalent of pg_restore --no-owner
    r'^ALTER\s+(TABLE|SEQUENCE|SCHEMA|FUNCTION|PROCEDURE|TYPE|DOMAIN|VIEW|MATERIALIZED VIEW|FOREIGN TABLE)\s'
    r'[^;]*?\sOWNER TO\s+("([^"]|"")+"|[A-Za-z0-9_$]+);\s*$')
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


_DOLLAR = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")


class _SqlScan:
    """Tracks, across lines, whether we are inside a quoted string, quoted identifier, dollar-quoted
    body or comment. It only decides where a COPY block may start: a file with no backslash outside
    COPY data has no escape for the quote rules to disagree with psql about (even under
    `standard_conforming_strings = off`). `mode` is None (plain SQL), "'", '"', "/*", or the closing "$tag$".
    """

    def __init__(self) -> None:
        self.mode: str | None = None
        self.depth = 0  # block-comment nesting

    @property
    def normal(self) -> bool:
        return self.mode is None

    def advance(self, line: str) -> None:
        i, n = 0, len(line)
        while i < n:
            c = line[i]
            mode = self.mode
            if mode is None:
                if c == "-" and line.startswith("--", i):
                    return  # line comment: the rest of the line is inert
                if c == "/" and line.startswith("/*", i):
                    self.mode, self.depth = "/*", 1
                    i += 2
                    continue
                if c == "'":
                    self.mode = "'"
                elif c == '"':
                    self.mode = '"'
                elif c == "$" and (i == 0 or not (line[i - 1].isalnum() or line[i - 1] == "_")):
                    m = _DOLLAR.match(line, i)
                    if m:
                        self.mode = m.group(0)
                        i = m.end()
                        continue
            elif mode == "'" or mode == '"':
                if c == mode:
                    self.mode = None  # a doubled quote closes and reopens on the next character
            elif mode == "/*":
                if line.startswith("*/", i):
                    self.depth -= 1
                    if self.depth == 0:
                        self.mode = None
                    i += 2
                    continue
                if line.startswith("/*", i):
                    self.depth += 1
                    i += 2
                    continue
            elif line.startswith(mode, i):  # dollar-quoted body ends at its own tag
                i += len(mode)
                self.mode = None
                continue
            i += 1


def inspect_dump(path: Path) -> set[str]:
    """Check the file and return the alembic revision(s) it holds. Raises RestoreRefused."""
    return inspect_bytes(filter_dump(path.read_bytes()), path.name)


def filter_dump(data: bytes) -> bytes:
    """Drop two kinds of line, outside COPY data only: `SET transaction_timeout` (older dumps carry one the
    database refuses) and `ALTER <object> ... OWNER TO <role>;` (a dump taken under another database user
    names a role this database lacks; same as pg_restore --no-owner). Never a COPY data row. Applied once, before inspection; the result is what is inspected and what is loaded,
    so a COPY block this simple tracking gets wrong can only make the inspection refuse, never skip it.
    """
    kept = []
    in_copy = False
    for raw in data.split(b"\n"):
        if in_copy:
            in_copy = raw.removesuffix(b"\r") != b"\\."
        else:
            line = raw.removesuffix(b"\r").decode("utf-8", errors="replace")
            if _COPY_START.match(line):
                in_copy = True
            elif line.startswith(_DROPPED) or _OWNER.match(line):
                continue
        kept.append(raw)
    return b"\n".join(kept)


def inspect_bytes(data: bytes, name: str) -> set[str]:
    """The check itself, on bytes read once, so what is checked is what is loaded."""
    complete = False
    in_copy = False
    in_version = False
    revisions: set[str] = set()
    scan = _SqlScan()
    # Bytes, split on \n only (as psql does): a lone \r is not a line break, so it is refused outside COPY data.
    if True:
        for raw in data.split(b"\n"):
            raw = raw.removesuffix(b"\r")
            line = raw.decode("utf-8", errors="replace")
            if not in_copy and any(byte >= 0x80 or (byte < 0x20 and byte != 9) for byte in raw):
                raise RestoreRefused("Refusing: the file holds a control character (a carriage return or NUL) "
                                     "or a non-ASCII byte outside COPY data, which a backup never does.")
            if in_copy:
                if line == "\\.":
                    in_copy = in_version = False
                elif in_version:
                    revisions.add(line.split("\t")[0])
                continue
            if scan.normal and _COPY_START.match(line):
                in_copy = True
                in_version = bool(_VERSION_COPY.match(line))
                continue
            if scan.normal and line.startswith(MARKER):
                complete = True
            if "\\" in line and not (scan.normal and _ALLOWED_META.match(line)):
                raise RestoreRefused("Refusing: the file holds a backslash outside COPY data (a possible psql "
                                     "command), which a backup never does.")
            scan.advance(line)
    if in_copy or not scan.normal:
        raise RestoreRefused(f"Refusing: {name} ends inside a string, comment or data block; "
                             "it was cut short or altered.")
    if not complete:
        raise RestoreRefused(f"Refusing: {name} does not end with '{MARKER}'; it was cut short.")
    if not revisions:
        raise RestoreRefused(f"Refusing: {name} holds no alembic_version, so it is not a backup of this app.")
    unknown = revisions - known_revisions()
    if unknown:
        raise RestoreRefused(f"Refusing: {name} holds a newer schema (revision {sorted(unknown)}) than "
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


def _load(data: bytes) -> None:
    args, database, env = _conn()
    proc = subprocess.Popen(
        ["psql", "-v", "ON_ERROR_STOP=1", "-q", "--single-transaction", *args, database],
        stdin=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
    err = b""
    try:
        proc.stdin.write(b"DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n")
        proc.stdin.write(data)  # exactly the bytes inspect_bytes checked
        proc.stdin.close()
    except BrokenPipeError:
        pass
    err = proc.stderr.read()
    if proc.wait() != 0:
        raise RestoreRefused(f"The load failed and was rolled back, so your data is as it was: "
                             f"{err.decode(errors='replace').strip()}")


def restore(name: str) -> Path:
    path = _resolve(name)
    data = filter_dump(path.read_bytes())
    inspect_bytes(data, path.name)
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
        _load(data)
        print(f"loaded {name}")
        try:
            upgrade.run()
        except Exception as exc:
            raise RestoreRefused(
                f"The data from {name} is loaded, but the migrations, seed or data steps failed: {exc}\n"
                f"Do not start the app. To undo, restore {undo.name} with the same command.")
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
