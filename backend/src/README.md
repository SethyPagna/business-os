# Backend Source

The backend is the final Docker runtime for Business OS.

- `database.js` exposes the Postgres database adapter.
- `postgresDatabase.js` provides the prepared-statement compatibility API used by existing route code while it is moved behind domain repositories.
- `objectStore.js` writes production files to the configured S3-compatible object store: R2 by default, MinIO for explicit emergency/offline mode.
- `services/` owns long-running business workflows such as imports, media jobs, Drive sync, and backup jobs.
- `routes/` stays as thin request/response wiring.

Production drivers are Postgres, R2 object storage, Redis/BullMQ, and DuckDB/Parquet snapshots. Emergency/offline mode uses the same adapter against MinIO.
