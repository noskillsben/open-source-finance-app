from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.schemas import LatestBackupOut
from app.services.backups import latest_backup

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


@router.get("/api/backups/latest/download")
def download_latest_backup() -> FileResponse:
    backup = latest_backup()
    if backup is None:
        raise HTTPException(status_code=404, detail=NONE_YET)
    return FileResponse(backup.path, media_type="application/sql", filename=backup.name)
