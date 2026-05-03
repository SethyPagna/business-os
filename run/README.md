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

These are for a private Docker release or support:

- `run\docker\install.bat` installs/pulls the Docker release.
- `run\docker\start.bat` starts Docker release services.
- `run\docker\update.bat` backs up, pulls, migrates, checks health, and rolls back when possible.
- `run\docker\backup.bat` backs up Docker release data from Postgres, MinIO, settings, users/roles, and runtime metadata.
- `run\docker\restore.bat` restores a selected verified backup.
- `run\docker\doctor.bat` diagnoses Docker, ports, registry login, Cloudflare, database, workers, and storage.
- `run\docker\rotate-cloudflare.bat` rotates the Cloudflare Tunnel token.

## Support-Only / Legacy

- `run\cloudflare-origin.bat` helps switch Cloudflare origin style.
- `run\start-server.bat` and `run\setup.bat` are source-checkout support tools, not the final customer runtime.
- Scale-service commands were removed from the normal run folder. Startup handles Docker services automatically; use `run\docker\doctor.bat` for diagnostics.
- `run\sh\` contains shell equivalents for non-Windows support.

Do not add new normal-user commands unless the root launcher cannot own the workflow.
