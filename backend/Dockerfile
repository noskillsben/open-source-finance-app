FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# PostgreSQL 16 client from the PGDG repo (amd64 and arm64), so pg_dump matches the postgres:16 database.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg     && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg     && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo $VERSION_CODENAME)-pgdg main" > /etc/apt/sources.list.d/pgdg.list     && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16     && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chmod +x /app/docker-entrypoint.sh /app/backup-nightly.sh
EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
