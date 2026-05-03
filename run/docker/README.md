# Docker Release Commands

Normal users should start Business OS with **`Start Business OS.bat`**. These files are support commands for the same local Docker release.

## Beginner Path

1. Double-click `Start Business OS.bat`.
2. Let it start Docker Desktop, the app container, Redis, Postgres, R2 object storage checks, workers, and Cloudflare.
3. Open:
   - Admin: `https://admin.leangcosmetics.dpdns.org`
   - Public: `https://leangcosmetics.dpdns.org/public`

No WSL command is required by Business OS. Docker Desktop may ask Windows to enable WSL2 during its own installation.

The release folder is complete when it contains `images\business-os-image.tar`. Copying or syncing the full `release\business-os` folder is enough for a new laptop.

## Support Commands

- `install.bat` loads/installs the Docker release.
- `start.bat` starts the Docker release directly.
- `update.bat` backs up, loads the newest local image bundle, health-checks, and rolls back when possible.
- `backup.bat` creates a Docker/Drive-compatible folder with `manifest.json`, `data.json`, `objects-manifest.jsonl`, `checksums.json`, restore metadata, and optional Parquet snapshots. Offline MinIO mode stores the same object keys through the emergency adapter.
- `restore.bat` restores a verified local backup folder or Google Drive `datasync-N` folder after validation.
- `doctor.bat` diagnoses Docker, services, Cloudflare, workers, and storage.
- `rotate-cloudflare.bat` rotates the Cloudflare Tunnel token after a secret leak.

Every command keeps the window open and prints the next step.
Before merging or shipping a release, run `doctor.bat` and confirm the Docker app container reports healthy.

## Data Mode

Live app data uses Postgres for business records and R2 for files/images/backups. Emergency/offline MinIO uses the same storage adapter and object keys. Local backups and Google Drive `datasync-N` versions use the same restore format, so Docker can recover either one through `restore.bat`.

## Auth And Storage Checklist

- Keep real credentials in `ops\runtime\docker-release\docker-release.env`; never in tracked docs or code.
- R2 is the normal object store. MinIO is only for explicit emergency/offline mode.
- Google Drive sync uses the OAuth client named `Business-os Drive` with callbacks under `/api/system/drive-sync/oauth/callback` for admin, public, and localhost URLs.
- Supabase Google/Gmail login uses the separate OAuth client named `business-os` and the Supabase callback URL.
- The Backup page Integration Doctor verifies Postgres, Redis jobs/cache, object storage, Drive sync, Supabase Auth, DuckDB/Parquet, and backup package format with all secret values redacted.
- Integration Doctor is a read-only check. It should not send request bodies with GET/HEAD/OPTIONS calls and should not display write-failed banners for health checks.

The retired standalone Windows EXE/NSIS release is no longer part of the supported release flow. Use `run\build-release.bat` or `run\docker\release.bat`; both produce the Docker release kit.
