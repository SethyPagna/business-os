# Docker Release Commands

Normal users should start Business OS with **`Start Business OS.bat`**. These files are for support, updates, and private Docker release operations.

## Beginner Path

1. Double-click `Start Business OS.bat`.
2. Let it start Docker Desktop, the app container, Redis, Postgres, MinIO, workers, and Cloudflare.
3. Open:
   - Admin: `https://admin.leangcosmetics.dpdns.org`
   - Public: `https://leangcosmetics.dpdns.org/public`

No WSL command is required by Business OS. Docker Desktop may ask Windows to enable WSL2 during its own installation. The launcher also checks Cloudflare Tunnel (`cloudflared`) and can install it with `winget` when Windows allows it.

Setup/start also keeps Docker tidy:

- setup pulls the current app, Redis, Postgres, MinIO, worker, and Cloudflare service images,
- startup removes stopped Business OS containers before starting services,
- data volumes are preserved and are not deleted by startup cleanup,
- the app data lives in the Docker runtime volume for the runnable Docker release,
- Postgres 18 uses the supported parent data-volume layout so Docker image updates do not strand the service in a restart loop.

## Support Commands

- `install.bat` pulls/installs the Docker release.
- `start.bat` starts the Docker release directly.
- `update.bat` backs up, pulls the newest release, migrates, health-checks, and rolls back when possible.
- `backup.bat` creates a Docker runtime-volume backup for the current runnable release. Postgres/MinIO backup mode is used after the verified Postgres data mode is enabled.
- `restore.bat` restores a verified Docker runtime-volume or Postgres backup.
- `doctor.bat` diagnoses Docker, services, Cloudflare, workers, and storage.
- `rotate-cloudflare.bat` rotates the Cloudflare Tunnel token after a secret leak.

Every command keeps the window open and prints the next step.

## Current Data Mode

The Docker release now runs without source bind mounts. Live app data is stored in the Docker runtime volume, and first start copies existing `business-os-data` into that volume only if the volume is empty. This avoids a hidden second database while making the no-source Docker release usable today.

SQLite-in-Docker is intentionally capped to one import writer and conservative media concurrency. That is safer for current data, but it is not the final heavy-load architecture. Postgres and MinIO remain part of the Docker ecosystem and are ready for the verified migration path, but Business OS does not claim full Postgres serving until every route has been cut over and verified.
