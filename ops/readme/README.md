# Business OS Operator Guide

This guide is for support, installers, and technical operators. Everyday users should read the root `README.md` and use only `run\setup.bat`, `run\start-server.bat`, and `run\stop-server.bat`.

## Runtime Model

Business OS now starts as one application, but it depends on local scale services:

- Redis for import queues
- Postgres for the future verified migration target
- MinIO for the future verified asset-storage target
- SQLite and local files as the current authoritative business data source

`run\start-server.bat` starts Docker Desktop when possible, launches the Compose stack, waits for Redis/Postgres/MinIO health, starts the backend/frontend, starts Cloudflare Tunnel, and prints the local and customer URLs.

The app does not silently switch live business data to Postgres/MinIO. SQLite/local files stay authoritative until an admin uses Settings > Backup > Data migration and completes a verified migration workflow. The current one-button safety step does run automatically inside the app: it creates a local folder backup and then runs Google Drive sync when Drive is connected, without changing the live data source.

The public URL check intentionally verifies HTTPS routes through the configured Cloudflare custom domain. If the app routes return locally but the public URL fails, the local app is healthy and the Cloudflare tunnel or DNS route needs attention.

## New Laptop Setup

Run from the repo root or installed app folder:

```bat
run\setup.bat
```

The setup flow uses `ops\scripts\powershell\runtime-bootstrap.ps1` before Node is required. It detects:

- Node.js
- Docker Desktop
- Git
- OpenSSL

When `winget` is available, setup tries to install missing tools automatically. If Windows needs administrator approval or a restart, setup stops with a clear message.

## Daily Start / Stop

```bat
run\start-server.bat
run\stop-server.bat
```

To stop the app and the scale services during support work:

```bat
run\stop-server.bat --with-services
```

## Support Service Commands

These commands are hidden from normal user instructions:

```bat
run\scale-services.bat status
run\scale-services.bat logs
run\scale-services.bat up
run\scale-services.bat down
```

The batch wrapper delegates to the shared PowerShell bootstrapper and uses a project-local Docker config folder at `ops\runtime\docker-config` to avoid user profile Docker config permission issues.

## Data Layout

The storage container is `business-os-data`. Active organization data resolves to:

```text
business-os-data\organizations\<public_id> (<sanitized-name>)\
```

Typical organization contents:

- `db\business.db`
- `uploads\`
- `imports\`
- `backups\`
- `portal\`

Packaged releases preserve:

- `release\business-os\business-os-data`
- `release\business-os\.env`
- `release\business-os\data-location.json`

## Environment Defaults

Setup and release templates default to required scale services while keeping SQLite/local data authoritative:

```env
BUSINESS_OS_REQUIRE_SCALE_SERVICES=1
JOB_QUEUE_DRIVER=bullmq
REDIS_URL=redis://127.0.0.1:6379
DATABASE_DRIVER=sqlite
OBJECT_STORAGE_DRIVER=local
```

Postgres and MinIO are started and health-checked, but `DATABASE_DRIVER=sqlite` and `OBJECT_STORAGE_DRIVER=local` stay in place until the migration wizard is explicitly completed.

The migration safety automation writes local snapshots to a sibling folder named `business-os-safety-backups`. That folder is intentionally ignored by Git and can be copied or synced externally. If Google Drive sync is connected, the same safety step also mirrors the current live data folder to Drive before reporting readiness.

## Secrets

Do not commit local service secrets. The following remain ignored:

- `minio.license`
- `*.license`
- `ops\runtime\secrets\`
- `runtime\secrets\`
- `.env`

The bootstrapper copies root `minio.license` into ignored runtime secret storage when present, or creates an empty placeholder so Compose can start without exposing the token.

## Release Build

```bat
run\build-release.bat
```

The release output includes:

- `business-os-server.exe`
- release `start-server.bat` / `stop-server.bat`
- `ops\docker\compose.scale.yml`
- `ops\scripts\powershell\runtime-bootstrap.ps1`
- `.env` template with scale defaults
- preserved data and data-location files

The desktop shortcut and portable release both use the same one-button start flow.

## Verification

```bat
run\verify-local.bat
```

Verification now requires scale service health. It fails fast if Docker Desktop or Redis/Postgres/MinIO are unavailable.

Technical reference docs remain under `ops\docs\`. Generated references are under `ops\docs\reference\` and are not normal user reading.
