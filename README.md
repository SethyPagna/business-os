# Business OS

Business OS is Windows business software: one launcher starts the app, Docker services, workers, backups, and Cloudflare access.

## Which File Do I Use?

Use **`Start Business OS.bat`** in the root folder.

Do not open Docker Compose, Redis, Postgres, MinIO, workers, Node, npm, or Cloudflare commands for everyday use. The `run\` folder is for support, updates, backup/restore, diagnostics, and source-development tasks.

## Blank Windows Laptop To Running App

1. Copy the complete **Business OS Docker portable folder** to the laptop.
2. Double-click **`Start Business OS.bat`**.
3. Let Business OS check Docker Desktop and Cloudflare Tunnel.
4. If Windows asks for administrator permission, WSL2, virtualization, or a restart, accept it. Business OS does not require Linux commands; Docker Desktop may need WSL2 internally.
5. Restart Windows if Docker asks.
6. Double-click **`Start Business OS.bat`** again.
7. Wait until the window says Business OS is ready.
8. Open the URLs printed in the window.

For a laptop without source code, build the release with `run\build-release.bat` or `run\docker\release.bat`, copy the full `release\business-os\` folder, then double-click **`Start Business OS.bat`** inside that folder.

Normal URLs:

- Server laptop: `http://localhost:4000`
- Admin from other devices: `https://admin.leangcosmetics.dpdns.org`
- Public customer portal: `https://leangcosmetics.dpdns.org/public`

## Final Data Architecture

- Postgres owns live products, stock, POS, sales, returns, contacts, users, roles, settings, portal, audit, history, imports, and backup metadata.
- MinIO owns uploads, product images, logos, avatars, portal/about images, file library assets, thumbnails, import media, backup assets, and Parquet snapshots.
- Redis owns durable jobs and short-lived cache.
- DuckDB/Parquet owns heavy staging and read-only workloads such as CSV import staging, conflict scans, exports, analytics snapshots, and backup verification.

Old loose data folders are not accepted by the final app. Use a verified backup folder or Google Drive `datasync-N` folder so older data cannot overwrite newer Docker data by accident.

## Docker Data: Copy, Restore, Update

The release folder is portable when it contains:

- `Start Business OS.bat`
- `images\business-os-image.tar`
- `ops\runtime\docker-release\docker-release.env`
- `run\docker\*.bat`

Safest way to move data:

1. On the old laptop, run `run\docker\backup.bat`.
2. Copy the newest timestamped backup folder from `ops\runtime\docker-release\backups\`, or choose the matching Google Drive `datasync-N` folder.
3. On the new laptop, copy the full `release\business-os\` folder, including `images\business-os-image.tar`.
4. Run `run\docker\restore.bat -BackupPath "C:\path\to\that\backup-folder"`.
5. Double-click **`Start Business OS.bat`** and check products, sales, files, settings, and portal content.

Backup format:

- Local backups and Google Drive `datasync-N` versions use the same folder shape.
- Each recoverable folder contains `manifest.json`, `backup.json`, `postgres.sql`, `minio.tgz`, `parquet-manifest.json`, and `checksums.sha256`.
- Docker restore validates that folder before replacing live data.

## Public Languages

The customer portal uses first-party language packs for fast public switching. English, Khmer, Chinese simplified/traditional, Vietnamese, Thai, Russian, French, Spanish, German, Japanese, Korean, Portuguese, Italian, Arabic, Hindi, Indonesian, Malay, and Turkish switch without loading Google Translate.

Google Translate remains only a slower fallback for unsupported languages. Business name, portal intro, and short tagline stay in the original business text.

## Large Imports

Large product, inventory, sales, customer, supplier, and delivery imports run as background jobs.

- Workers stay idle when no large action exists and wake automatically when jobs are queued.
- CSV/TSV parsing preserves Khmer text and rounds money/percent values upward to two decimals.
- Product conflicts are grouped by same name, same SKU/barcode, and errors/issues.
- Imports wait for review before applying large changes.
- Cancel, retry, failed-row download, remove, undo, and redo are available where supported.

## Update, Backup, Restore

- Start: `Start Business OS.bat`
- Stop: `run\stop-server.bat`
- Diagnose: `run\docker\doctor.bat`
- Backup: `run\docker\backup.bat`
- Restore: `run\docker\restore.bat`
- Update Docker release: `run\docker\update.bat`

Every user-facing command window stays open and prints what to do next.

## Cloudflare Safety

Business OS uses Cloudflare for the public/admin links. If a Cloudflare tunnel token, origin private key, or API token was pasted into chat or sent to anyone, treat it as compromised and rotate it with `run\docker\rotate-cloudflare.bat --disconnect-old`.
