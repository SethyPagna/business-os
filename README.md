# Business OS

Business OS is designed for a normal Windows business laptop: one setup, one start button, and one public Cloudflare link for other devices.

## Blank Laptop Setup

Start here if the laptop has nothing installed.

1. Download or copy the Business OS folder onto the laptop.
2. Right-click `run\setup.bat` and choose **Run as administrator**.
3. Let setup install or check Docker Desktop, Node.js, Git, OpenSSL, and Cloudflare support files.
4. If Windows asks for a restart, restart the laptop and run `run\setup.bat` again.
5. When setup finishes, run `run\start-server.bat`.
6. Open the URL printed in the start window.

Normal URLs:

- Local/admin on the server laptop: `http://localhost:4000`
- Staff/admin from other devices: `https://admin.leangcosmetics.dpdns.org`
- Public customer portal: `https://leangcosmetics.dpdns.org/public`

You do not need to run Docker Compose, Redis, Postgres, MinIO, workers, or Cloudflare commands by hand. The start script owns that.

## Daily Use

1. Turn on the server laptop.
2. Open Docker Desktop if Windows did not start it automatically.
3. Run `run\start-server.bat`.
4. Use the admin or public Cloudflare URL on phones/tablets/other computers.
5. Run `run\stop-server.bat` before shutting the laptop down.

If the public URL fails but `http://localhost:4000` works, the app is running and Cloudflare Tunnel needs attention. The tunnel origin should point to `http://127.0.0.1:4000` for the Windows-host runtime, or `http://app:4000` for the Docker-only private release.

## Data Safety

Your live business data currently stays on the server laptop under:

`business-os-data\organizations\<organization-id> (<business-name>)\`

Backups, uploaded files, imports, and the live SQLite database are stored there. Backup and reset actions cancel running imports first so old background jobs cannot keep writing after a destructive action.

Google Drive sync is managed in Settings > Backup. Use it as a backup/sync target, not as the only copy of the business database.

## Large Imports

Large product, inventory, sales, customer, supplier, and delivery imports run as background jobs.

- Uploading returns quickly with a job tracker at the top of the app.
- CSV/TSV parsing preserves Khmer text and rounds money/percent values upward to two decimals.
- Product conflicts are grouped by same name and identifier conflicts such as same SKU/barcode.
- Imports wait for review before applying large changes.
- Cancel, retry, failed-row download, and remove are available from the top tracker.

Keep using the app while imports run. If an import is no longer needed, remove it from the tracker so uploaded temp files are cleaned.

## Support Commands

Only use these if support asks:

- `run\scale-services.bat status`
- `run\scale-services.bat logs`
- `run\cloudflare-origin.bat host`
- `run\cloudflare-origin.bat docker`
- `run\stop-server.bat --with-services`

Technical notes are in `ops\readme\README.md`.

## Docker-Only Private Release

Use this when you want another device to run Business OS without receiving the source repository.

Developer machine:

1. Run `run\docker\release.bat` to build the private Docker image.
2. Run `run\docker\publish-release.bat` to push the image to the private registry.

Business/user machine:

1. Run `run\docker\install.bat` once.
2. Put a Cloudflare API token with Tunnel write permission in `ops\runtime\secrets\cloudflare-api-token.txt`.
3. Run `run\docker\rotate-cloudflare.bat --disconnect-old` if the tunnel token was pasted, shared, or may be compromised.
4. Run `run\docker\start.bat`.
5. Run `run\docker\update.bat` whenever a new version is published.

The Docker-only release uses Postgres, Redis, MinIO, workers, and Cloudflare Tunnel containers. It does not bind-mount this source folder into runtime containers. It also refuses to silently run SQLite in production release mode.

Important: the current source app still contains SQLite-specific route code. The Docker-only release tooling and migrator are in place, but production serving remains guarded until the route-level Postgres data-layer cutover is completed. This prevents accidental data loss or a hidden throwaway SQLite database inside Docker.

## Cloudflare Safety

Business OS now uses Cloudflare for the public/admin links. Tailscale is legacy support only and is not part of normal setup.

If a Cloudflare tunnel token, origin private key, or API token was pasted into chat or sent to anyone, treat it as compromised:

1. Create or confirm a Cloudflare API token with Cloudflare Tunnel write permission.
2. Save it locally only in `ops\runtime\secrets\cloudflare-api-token.txt`.
3. Run `run\docker\rotate-cloudflare.bat --disconnect-old`.
4. Restart with `run\docker\start.bat`.

The rotation script updates the tunnel to route `leangcosmetics.dpdns.org` and `admin.leangcosmetics.dpdns.org` to the Docker app service (`http://app:4000`) and writes the new connector token only into ignored runtime secret files.
