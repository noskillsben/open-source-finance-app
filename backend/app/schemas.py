"""Pydantic models — the API shape. Never persisted."""
from pydantic import BaseModel


class Health(BaseModel):
    status: str
    database: str
    app_mode: str
