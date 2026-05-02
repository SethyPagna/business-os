# Docker Release Commands

Normal users should start Business OS with **`Start Business OS.bat`**. These files are for support, updates, and private Docker release operations.

## Beginner Path

1. Double-click `Start Business OS.bat`.
2. Let it start Docker Desktop, Postgres, Redis, MinIO, workers, and Cloudflare.
3. Open:
   - Admin: `https://admin.leangcosmetics.dpdns.org`
   - Public: `https://leangcosmetics.dpdns.org/public`

No WSL command is required by Business OS. Docker Desktop may ask Windows to enable WSL2 during its own installation. The launcher also checks Cloudflare Tunnel (`cloudflared`) and can install it with `winget` when Windows allows it.

Setup/start also keeps Docker tidy:

- setup pulls the current Redis/Postgres/MinIO service images,
- startup removes stopped Business OS containers before starting services,
- data volumes are preserved and are not deleted by startup cleanup,
- Postgres 18 uses the supported parent data-volume layout so Docker image updates do not strand the service in a restart loop.

## Support Commands

- `install.bat` pulls/installs the Docker release.
- `start.bat` starts the Docker release directly.
- `update.bat` backs up, pulls the newest release, migrates, health-checks, and rolls back when possible.
- `backup.bat` creates a release backup.
- `restore.bat` restores a verified backup.
- `doctor.bat` diagnoses Docker, services, Cloudflare, workers, and storage.
- `rotate-cloudflare.bat` rotates the Cloudflare Tunnel token after a secret leak.

Every command keeps the window open and prints the next step.

## Current Guardrail

The Docker-only release tooling is present, but production serving stays guarded until every route is cut over to Postgres/MinIO. This is intentional: silently serving from SQLite inside Docker could create a second hidden database and risk data loss.
