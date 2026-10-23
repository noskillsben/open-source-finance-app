from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.db import get_session
from app.services.export import build_export

router = APIRouter()


@router.get("/api/export")
def export_data(session: Session = Depends(get_session)) -> Response:
    """Everything, as one zip of CSVs. The filename's date is wall-clock provenance only."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    return Response(
        build_export(session),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="export-{stamp}.zip"'},
    )
