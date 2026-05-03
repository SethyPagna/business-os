# Docker Release Commands

Normal users should start Business OS with **`Start Business OS.bat`**. These files are support commands for the same local Docker release.

## Beginner Path

1. Double-click `Start Business OS.bat`.
2. Let it start Docker Desktop, the app container, Redis, Postgres, MinIO, workers, and Cloudflare.
3. Open:
   - Admin: `https://admin.leangcosmetics.dpdns.org`
   - Public: `https://leangcosmetics.dpdns.org/public`

No WSL command is required by Business OS. Docker Desktop may ask Windows to enable WSL2 during its own installation.

The release folder is complete when it contains `images\business-os-image.tar`. Copying or syncing the full `release\business-os` folder is enough for a new laptop.

## Support Commands

- `install.bat` loads/installs the Docker release.
- `start.bat` starts the Docker release directly.
- `update.bat` backs up, loads the newest local image bundle, health-checks, and rolls back when possible.
- `backup.bat` creates a Docker/Drive-compatible folder with `manifest.json`, `postgres.sql`, `minio.tgz`, Parquet metadata, and checksums.
- `restore.bat` restores a verified local backup folder or Google Drive `datasync-N` folder after validation.
- `doctor.bat` diagnoses Docker, services, Cloudflare, workers, and storage.
- `rotate-cloudflare.bat` rotates the Cloudflare Tunnel token after a secret leak.

Every command keeps the window open and prints the next step.

## Data Mode

Live app data uses Postgres for business records and MinIO for files/images/backups. Local backups and Google Drive `datasync-N` versions use the same restore format, so Docker can recover either one through `restore.bat`.

The retired standalone Windows EXE/NSIS release is no longer part of the supported release flow. Use `run\build-release.bat` or `run\docker\release.bat`; both produce the Docker release kit.
