# Backend Source

The backend is the final Docker runtime for Business OS.

- `database.js` exposes the Postgres database adapter.
- `postgresDatabase.js` provides the prepared-statement compatibility API used by existing route code while it is moved behind domain repositories.
- `objectStore.js` writes production files to MinIO.
- `services/` owns long-running business workflows such as imports, media jobs, Drive sync, and backup jobs.
- `routes/` stays as thin request/response wiring.

Production drivers are Postgres, MinIO, Redis/BullMQ, and DuckDB/Parquet snapshots.
