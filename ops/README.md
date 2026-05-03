# Ops Folder

`ops` contains support files used by launchers, release builds, verification, and Docker runtime automation.

## Folder Guide

- `config\` support configuration. The retired NSIS/standalone EXE installer is no longer the release path.
- `docker\` final Docker Compose and Dockerfile assets for Redis, Postgres, MinIO, app, workers, and Cloudflare.
- `docs\` generated/reference documentation. Not required for everyday users.
- `reports\` tracked verification and audit reports.
- `runtime\` ignored local runtime output: logs, generated Docker profile, local secrets, temp data, and Docker config.
- `scripts\` PowerShell/Node/runtime scripts used by the `.bat` files.
- `readme\` technical/operator notes retained for support.
- `demo\` generated or optional demo artifacts. Ignored demo lockfiles can be cleaned; production lockfiles live only in `backend\` and `frontend\`.

## Rules

- Keep secrets under `ops\runtime\secrets\`; never commit them.
- Keep normal user instructions in the root `README.md`.
- Keep manual Docker/Cloudflare commands out of beginner docs unless they are explicitly support-only.
- Keep route/runtime docs current when import jobs, backup diagnostics, audit retention, permissions, Docker release checks, or receipt rendering behavior changes.
- Archive questionable old files first, then delete only after `git grep` and verification prove they are unused.
