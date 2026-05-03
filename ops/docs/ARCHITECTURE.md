# Business OS Architecture

Business OS final runtime is Docker-first:

- Postgres is the live transactional database.
- R2 is the normal object store for uploads, images, backup assets, and snapshots. MinIO is reserved for explicit emergency/offline mode through the same object-storage keys.
- Redis/BullMQ runs imports, media work, backups, Drive sync, and cache.
- DuckDB/Parquet is for worker-owned staging, exports, analytics, and backup verification.

Routes should remain thin controllers. Domain services own business rules, repositories own persistence, and storage adapters own files.

Import jobs are lifecycle-driven background work. Controllers create/upload/start/cancel/retry/approve/delete jobs, services enforce cancellation and retry rules, workers analyze/apply rows, and audit events record actor attribution for each state change.

Admin-only reporting filters must be enforced server-side. Audit Log, sales, inventory movements, and product action history can expose user filters only to administrator-control users; non-admin users keep their normal permission and ownership limits.
