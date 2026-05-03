# File Map

- `backend/src/database.js`: final Postgres adapter entrypoint.
- `backend/src/postgresDatabase.js`: prepared-statement bridge for current route code.
- `backend/src/services`: imports, media queue, backup/Drive jobs, and business workflows.
- `frontend/src`: React app and page flows.
- `ops/docker`: Docker Compose and Dockerfile for the portable release.
- `run/docker`: support commands for install, start, backup, restore, update, and doctor.
