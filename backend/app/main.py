from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import held, startup_check
from app.config import settings
from app.db import get_session
from app.routers import accounts, backups, categories, earmarks, export, income_streams, integrity, payees_domains, splits, transactions
from app.schemas import Health
from app.services.backups import latest_backup



@asynccontextmanager
async def lifespan(_app: FastAPI):
    held.set_held(startup_check.is_held())  # decided once, by the same rule as the entrypoint's check
    yield


app = FastAPI(title="Open Source Finance App", version="0.0.1", docs_url="/docs", openapi_url="/api/openapi.json",
              lifespan=lifespan)


@app.middleware("http")
async def refuse_while_held(request: Request, call_next):
    if held.held and request.url.path.startswith("/api") and not held.is_allowed(request.method, request.url.path):
        return JSONResponse(status_code=409, content={"detail": held.MESSAGE})
    return await call_next(request)


@app.get("/api/health", response_model=Health)
def health(session: Session = Depends(get_session)) -> Health:
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except Exception as exc:  # the health page is the one place a swallowed error is acceptable
        database = f"error: {type(exc).__name__}"
    backup = latest_backup() if held.held else None
    return Health(status="ok", database=database, app_mode=settings.app_mode,
                  held=held.held, latest_backup=backup.name if backup else None)


app.include_router(accounts.router)
app.include_router(categories.router)
app.include_router(earmarks.router)
app.include_router(transactions.router)
app.include_router(income_streams.router)
app.include_router(payees_domains.router)
app.include_router(splits.router)
app.include_router(integrity.router)
app.include_router(backups.router)
app.include_router(export.router)
