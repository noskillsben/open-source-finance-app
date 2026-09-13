from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.schemas import Health

app = FastAPI(title="Open Source Finance App", version="0.0.1", docs_url="/docs", openapi_url="/api/openapi.json")


@app.get("/api/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # the health page is the one place a swallowed error is acceptable
        database = f"error: {type(exc).__name__}"
    return Health(status="ok", database=database, app_mode=settings.app_mode)
