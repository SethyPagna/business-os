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
- `stop.bat` stops it (app, workers, cloudflared — Postgres/Redis are left running so the next start is fast). `run\stop-server.bat` at the repo root forwards here too; it used to target a retired compose stack and silently not stop anything real, which is now fixed.
- `update.bat` backs up, loads the newest local image bundle, health-checks, and rolls back when possible.
- `backup.bat` creates a Docker/Drive-compatible folder with `manifest.json`, `data.json`, `objects-manifest.jsonl`, `checksums.json`, restore metadata, and optional Parquet snapshots. Offline MinIO mode stores the same object keys through the emergency adapter.
- `restore.bat` restores a verified local backup folder or Google Drive `datasync-N` folder after validation.
- `doctor.bat` diagnoses Docker, services, Cloudflare, workers, and storage. It now also checks the Cloudflare Tunnel connector directly (token file, active connections, ingress routes) — this is the check that surfaces the cause of Error 1033 / 530. It also self-heals a couple of safe gaps: creating the external Docker volume if it's missing (see below).
- `verify-tunnel.bat` runs only the Cloudflare Tunnel check on its own, for a fast recheck after a fix.
- `rotate-cloudflare.bat` rotates the Cloudflare Tunnel token after a secret leak, and is also how you fetch a first tunnel token on a brand-new machine.

Every command keeps the window open and prints the next step.
Before merging or shipping a release, run `doctor.bat` and confirm the Docker app container reports healthy.

## Data Mode

Live app data uses Postgres for business records and R2 for files/images/backups. Emergency/offline MinIO uses the same storage adapter and object keys. Local backups and Google Drive `datasync-N` versions use the same restore format, so Docker can recover either one through `restore.bat`.

## Auth And Storage Checklist

- Keep real credentials in `ops\runtime\docker-release\docker-release.env`; never in tracked docs or code.
- R2 is the normal object store. MinIO is only for explicit emergency/offline mode.
- Google Drive sync uses the OAuth client named `Business OS Drive` with callbacks under `/api/system/drive-sync/oauth/callback` for admin, public, and localhost URLs.
- Google/Gmail login uses the separate owned OAuth client named `Business OS Google login` with `/api/auth/oauth/callback` for admin, public, and localhost URLs.
- The Backup page Integration Doctor verifies Postgres, Redis jobs/cache, object storage, Drive sync, Google login, DuckDB/Parquet, and backup package format with all secret values redacted.
- Integration Doctor is a read-only check. It should not send request bodies with GET/HEAD/OPTIONS calls and should not display write-failed banners for health checks.

The retired standalone Windows EXE/NSIS release is no longer part of the supported release flow. Use `run\build-release.bat` or `run\docker\release.bat`; both produce the Docker release kit.

## Troubleshooting: "portal catalog search" (or other public routes) return 500, but /health returns 200

This is a Postgres password mismatch, not an application bug — confirmed by running
the exact failing route directly against a real Postgres instance, where it returned
200 with correct data. `docker-release.ps1`'s `Doctor` and `Start` now detect this
automatically (`Test-PostgresPasswordMismatch`) and print the explanation below, but
here's the short version:

The `postgres` container only applies `POSTGRES_PASSWORD` the **very first time** it
starts against an empty data volume. If `ops\runtime\docker-release\docker-release.env`
ever gets regenerated with a new password after Postgres has already initialized once
on this machine (for example, a fresh `docker-release.env` was copied in from
somewhere), the running database keeps its *old* password — every connection using
the new one fails with `password authentication failed for user "business_os"`, even
though the app container reports "healthy" (its health check doesn't query the
database, so only routes that actually touch Postgres fail).

Fix — pick one:
- No real data yet: `docker compose --env-file "ops\runtime\docker-release\docker-release.env" -f "ops\docker\compose.release.yml" down`, then `docker volume rm business-os_business_os_postgres`, then `run\docker\start.bat` to let Postgres re-initialize fresh.
- Real data to keep: edit `POSTGRES_PASSWORD` in `docker-release.env` back to whatever Postgres was originally created with.

## Troubleshooting: Error 1033 / 530 ("Cloudflare Tunnel error")

This means Cloudflare's edge has nobody to hand your request to — the `cloudflared` container isn't currently registered as a connector for the tunnel. If `docker compose logs cloudflared` shows:

```
"cloudflared tunnel run" requires the ID or name of the tunnel to run as the last command line argument or in the configuration file.
```

that is cloudflared's own error for an empty or unreadable token file (cloudflared can't extract a tunnel ID from nothing) — this is check #2 below, and the fix is the same `rotate-cloudflare.bat` command.

Run:

```
run\docker\verify-tunnel.bat
```

It checks, in order, and tells you exactly which one is the problem:

1. `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_TUNNEL_ID` / `CLOUDFLARE_API_TOKEN` are set.
2. The tunnel connector token file (what `cloudflared` itself authenticates with — separate from the API token) exists and isn't empty.
3. The Cloudflare API reports at least one active connection for the tunnel.
4. The tunnel's ingress config actually routes your admin/public hostnames (not just the 404 fallback).
5. The `cloudflared` container is running, and its recent logs don't show an auth/registration failure.
6. `cloudflared`'s own connectivity pre-check (`cloudflared tunnel diag`, built into the binary since v2026.5.2) — confirms DNS resolution to Cloudflare's tunnel endpoints and outbound port 7844 (TCP/UDP) actually work from inside the container. This is the one that catches a router or firewall blocking the tunnel's connection, which is a different problem than 1-5 above (those all assume the connection *can* be made and check whether it *was*).

If check 6 fails specifically, the fix is on your network, not in this repo: outbound TCP/UDP 7844 to Cloudflare's edge is being blocked somewhere between this machine and the internet (a strict router, VPN, or corporate firewall). Confirm with your network administrator or try a different network.

The most common cause overall is #2: the connector token file is empty or stale. Fix it with:

```
run\docker\rotate-cloudflare.bat
```

That fetches a fresh tunnel token from Cloudflare using `CLOUDFLARE_API_TOKEN` and writes it to the connector token file, then you restart with `run\docker\start.bat`. The API token needs the permission set listed in `ops\automation\README.md` (it must include **Account: Cloudflare Tunnel Edit**).
