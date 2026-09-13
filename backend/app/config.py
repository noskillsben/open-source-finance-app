"""Settings. One authority for the database URL — the app, Alembic and the startup check all read this."""
from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_mode: str = "single_user"  # or multi_user (not built)
    postgres_user: str = "finance"
    postgres_password: str = "finance"
    postgres_db: str = "finance"
    postgres_host: str = "db"
    postgres_port: int = 5432
    database_url_override: str | None = Field(default=None, validation_alias="DATABASE_URL")  # bypasses the parts above

    @computed_field  # type: ignore[misc]
    @property
    def database_url(self) -> str:
        if self.database_url_override:
            return self.database_url_override
        return (f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
                f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}")


settings = Settings()
