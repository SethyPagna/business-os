# Business OS Architecture

Business OS final runtime is Docker-first:

- Postgres is the live transactional database.
- MinIO stores uploads, images, backup assets, and snapshots.
- Redis/BullMQ runs imports, media work, backups, Drive sync, and cache.
- DuckDB/Parquet is for worker-owned staging, exports, analytics, and backup verification.

Routes should remain thin controllers. Domain services own business rules, repositories own persistence, and storage adapters own files.
