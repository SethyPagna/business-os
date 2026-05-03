# Runtime Readme

Business OS final runtime uses Docker services:

- Postgres for live business data.
- MinIO for files and backup assets.
- Redis for queues/cache.
- DuckDB/Parquet for worker-owned snapshots and reports.

Do not manually copy old data folders into the runtime. Use `run\docker\backup.bat` and `run\docker\restore.bat`.
