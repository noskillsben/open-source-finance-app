"""The held state (DESIGN.md § Architecture Overview -> Backups are one mechanism).

Decided once at startup by `startup_check.is_held()` and kept in this process. While held the only
routes that answer are the ones the restore screen needs; a successful Restore clears it.
"""
held = False

MESSAGE = "No data loaded — restore a backup from Settings"

# (method, path) the restore screen uses; Restore is matched by shape because it carries a file name.
ALLOWED = {
    ("GET", "/api/health"),
    ("GET", "/api/backups"),
    ("GET", "/api/backups/latest"),
    ("GET", "/api/backups/latest/download"),
    ("POST", "/api/backups/upload"),
}


def set_held(value: bool) -> None:
    global held
    held = value


def is_allowed(method: str, path: str) -> bool:
    if (method, path) in ALLOWED:
        return True
    parts = path.split("/")
    return method == "POST" and len(parts) == 5 and parts[:3] == ["", "api", "backups"] and parts[4] == "restore"
