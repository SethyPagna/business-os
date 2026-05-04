# Run Commands

Normal users should only need **`Start Business OS.bat`** in the root folder.

If someone is setting up a blank business laptop, give them the installer or portable release folder and tell them to double-click the root launcher. They should not start here in `run\` unless support asks.

## User Commands

- `Start Business OS.bat` starts the app, Docker services, workers, and Cloudflare access.
- `run\setup.bat` prepares a source checkout on a developer laptop.
- `run\docker\start.bat` is the final Docker runtime launcher used by the root launcher.
- `run\start-server.bat` is support-only for source troubleshooting.
- `run\stop-server.bat` stops the app.
- `run\verify-local.bat` runs local verification checks.
- `run\build-release.bat` builds the final Docker portable release in `release\business-os\`.

All user-facing `.bat` files keep the window open and print the next step or repair command.

## Docker Release Commands

These are for the local Docker release or support:

- `run\docker\install.bat` installs the local Docker image bundle.
- `run\docker\start.bat` starts Docker release services.
- `run\docker\update.bat` backs up, reloads the local image bundle, checks health, and rolls back when possible.
- `run\docker\backup.bat` backs up Docker release data from Postgres, R2 or emergency/offline MinIO, settings, users/roles, and runtime metadata.
- `run\docker\restore.bat` restores a selected verified backup.
- `run\docker\doctor.bat` diagnoses Docker, ports, local image bundles, Cloudflare, database, workers, and storage.
- `run\docker\rotate-cloudflare.bat` rotates the Cloudflare Tunnel token.

## Release Verification

Before merging a release branch, run the backend utility suite, frontend utility suite, production frontend build, frontend i18n/UI/performance verifiers, backend integrity verifier, Docker release doctor, and local/public health checks. The Docker release is ready only when the app container is healthy and Postgres, Redis queue/cache, R2 object storage, BullMQ, DuckDB/Parquet, and Cloudflare diagnostics report clean status.

## Support-Only / Legacy

- `run\cloudflare-origin.bat` helps switch Cloudflare origin style.
- `run\start-server.bat` and `run\setup.bat` are source-checkout support tools, not the final customer runtime.
- Scale-service commands were removed from the normal run folder. Startup handles Docker services automatically; use `run\docker\doctor.bat` for diagnostics.
- `run\sh\` contains shell equivalents for non-Windows support.

Do not add new normal-user commands unless the root launcher cannot own the workflow.

## Runtime Secrets

Put real service credentials only in ignored runtime env files such as `ops\runtime\docker-release\docker-release.env`. The verification flow includes a tracked-secret hygiene check, and the Backup page Integration Doctor reports only redacted presence/status for R2, Google Drive OAuth, Google login, Cloudflare, and app secrets.
