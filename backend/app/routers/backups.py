from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app import restore as restore_script
from app.db import engine
from app.schemas import BackupFileOut, LatestBackupOut, RestoredOut
from app.services.backups import BackupBusy, BackupFailed, BackupSkipped, latest_backup, list_backups, take_backup_now

router = APIRouter()

NONE_YET = "No backup yet — the first one is taken at 03:00 UTC."


@router.get("/api/backups/latest", response_model=LatestBackupOut)
def latest_backup_info() -> LatestBackupOut:
    """What the Settings button shows: the newest nightly file's name and when it was taken,
    or both null when there is none yet. The filesystem path is never returned.
    """
    backup = latest_backup()
    if backup is None:
        return LatestBackupOut(name=None, taken_at=None)
    return LatestBackupOut(name=backup.name, taken_at=backup.taken_at)


@router.post("/api/backups", response_model=LatestBackupOut)
def take_backup() -> LatestBackupOut:
    """Back up now: runs the same script the nightly job uses, so the download includes what was just recorded."""
    try:
        backup = take_backup_now()
    except BackupBusy:
        raise HTTPException(status_code=409, detail="A backup is already being taken")
    except BackupSkipped as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except BackupFailed as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if backup is None:
        return LatestBackupOut(name=None, taken_at=None)
    return LatestBackupOut(name=backup.name, taken_at=backup.taken_at)


@router.get("/api/backups/latest/download")
def download_latest_backup() -> FileResponse:
    backup = latest_backup()
    if backup is None:
        raise HTTPException(status_code=404, detail=NONE_YET)
    return FileResponse(backup.path, media_type="application/sql", filename=backup.name)


@router.get("/api/backups", response_model=list[BackupFileOut])
def list_backup_files() -> list[BackupFileOut]:
    """Every backup file, newest first, for the Settings restore list. Names and dates only."""
    return [BackupFileOut(name=b.name, taken_at=b.taken_at) for b in list_backups()]


@router.post("/api/backups/{name}/restore", response_model=RestoredOut)
def restore_backup(name: str) -> RestoredOut:
    """Restore one listed file by calling the restore script's own function (no second copy of its checks).

    Deliberately takes no per-request DB session: an open transaction would block the script's DROP SCHEMA.
    """
    try:
        undo = restore_script.restore(name)
    except restore_script.RestoreRefused as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc) or "Restore failed")
    finally:
        engine.dispose()  # no pooled connection may survive into the replaced database
    return RestoredOut(restored=name, undo=undo.name)
