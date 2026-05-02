# Docker Release Commands

Normal users should start Business OS with **`Start Business OS.bat`**. These files are the final Docker release support, update, backup, restore, and private-image operations.

## Beginner Path

1. Double-click `Start Business OS.bat`.
2. Let it start Docker Desktop, the app container, Redis, Postgres, MinIO, workers, and Cloudflare.
3. Open:
   - Admin: `https://admin.leangcosmetics.dpdns.org`
   - Public: `https://leangcosmetics.dpdns.org/public`

No WSL command is required by Business OS. Docker Desktop may ask Windows to enable WSL2 during its own installation. The launcher also checks Cloudflare Tunnel (`cloudflared`) and can install it with `winget` when Windows allows it.

Setup/start also keeps Docker tidy:

- setup loads `images\business-os-image.tar` when the app image is not already present,
- setup pulls Redis, Postgres, MinIO, and Cloudflare service images when the internet is available,
- startup removes stopped Business OS containers before starting services,
- data volumes are preserved and are not deleted by startup cleanup,
- app data lives in Docker-managed Postgres and MinIO volumes,
- Postgres 18 uses the supported parent data-volume layout so Docker image updates do not strand the service in a restart loop.

GHCR is optional for local/Google Drive installs. A complete `release\business-os` folder contains the app image bundle, so copying or syncing that folder is enough for the app image. `publish-release.bat` is only needed when you want a private registry update.

## Support Commands

- `install.bat` pulls/installs the Docker release.
- `start.bat` starts the Docker release directly.
- `update.bat` backs up, pulls the newest release, migrates, health-checks, and rolls back when possible.
- `backup.bat` creates a Docker/Drive-compatible folder with `manifest.json`, `postgres.sql`, `minio.tgz`, Parquet metadata, and checksums.
- `restore.bat` restores a verified local backup folder or Google Drive `datasync-N` folder after validation.
- `doctor.bat` diagnoses Docker, services, Cloudflare, workers, and storage.
- `rotate-cloudflare.bat` rotates the Cloudflare Tunnel token after a secret leak.

Every command keeps the window open and prints the next step.

## Current Data Mode

The Docker release runs without source bind mounts. Live app data must use Postgres for business records and MinIO for files/images/backups. Loose `business-os-data` folders are not imported automatically.

SQLite/local storage is not a supported Docker production mode. If a remaining live route still imports the legacy SQLite module, startup must fail clearly until that route is cut over instead of pretending the release is ready.

Local backups and Google Drive `datasync-N` versions use the same restore format, so Docker can recover either one through `restore.bat`.

The retired standalone Windows EXE/NSIS release is no longer part of the supported release flow. Use `run\build-release.bat` or `run\docker\release.bat`; both produce the Docker release kit.
