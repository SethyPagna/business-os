# Business OS

Business OS is meant to feel like normal Windows business software: one launcher starts the app, required Docker services, workers, and Cloudflare access.

## Blank Windows Laptop To Running App

Use this path for a normal business/user laptop.

1. Download or copy the **Business OS portable folder** to the laptop, or run the Business OS installer.
2. Double-click **`Start Business OS.bat`**.
3. Business OS checks Docker Desktop and Cloudflare Tunnel (`cloudflared`).
4. If either tool is missing, Business OS tries to install it with Windows `winget`.
5. If Windows asks for administrator permission, WSL2, virtualization, or a restart, accept it. Business OS does not require you to use Linux commands; Docker Desktop may need WSL2 internally.
6. Restart Windows if Docker asks.
7. Double-click **`Start Business OS.bat`** again.
8. Wait until the window says Business OS is ready.
9. Open the URLs printed in the window.

What the launcher does for you:

- installs or guides Docker Desktop and Cloudflare Tunnel when Windows allows it,
- starts Docker Desktop services for Redis, Postgres, MinIO, app workers, and media workers,
- cleans stopped Business OS containers without deleting data volumes,
- pulls current Docker service images during setup,
- starts the Cloudflare connector for the public/admin links.

Normal URLs:

- Server laptop: `http://localhost:4000`
- Admin from other devices: `https://admin.leangcosmetics.dpdns.org`
- Public customer portal: `https://leangcosmetics.dpdns.org/public`

You do **not** need to run Docker Compose, Redis, Postgres, MinIO, workers, Node, npm, or Cloudflare commands by hand.

Cloudflare requires a local tunnel token file. The installer/portable folder should include it in ignored runtime secret storage, or support can create it with `run\docker\rotate-cloudflare.bat`. Never paste that token into chat or commit it to Git.

### Moving To A New Laptop With Data

1. On the old laptop, run a Business OS backup first.
2. Copy the full Business OS folder or install the new release on the new laptop.
3. Copy the backup or `business-os-data` folder to the new laptop.
4. Double-click **`Start Business OS.bat`**.
5. Restore the backup from the app or `run\docker\restore.bat` if support asks.
6. Confirm products, contacts, sales, files, portal settings, and logos before using the new laptop for live work.

## Source Checkout Setup

Use this only when working from the source code folder.

1. Run `run\setup.bat` once.
2. After setup, double-click **`Start Business OS.bat`**.
3. For support diagnostics, run `run\docker\doctor.bat`.

The root folder intentionally has no `package.json` and no root `node_modules`. Keep lockfiles only in `backend\package-lock.json` and `frontend\package-lock.json`.

## Daily Use

1. Turn on the server laptop.
2. Double-click **`Start Business OS.bat`**.
3. Use the admin or public Cloudflare URL on phones, tablets, and other computers.
4. Run `run\stop-server.bat` before shutting the laptop down.

If the public URL fails but `http://localhost:4000` works, the app is running and Cloudflare Tunnel needs attention. Use `run\docker\doctor.bat` first.

## Data And Backups

Current source-runtime business data stays under:

`business-os-data\organizations\<organization-id> (<business-name>)\`

Google Drive sync is managed in **Settings > Backup**. Use it as a backup/sync target, not as the only copy of the business database.

Docker-only production release support is being guarded until the remaining route-level Postgres/MinIO cutover is complete. The tooling must not silently serve from a hidden SQLite database inside Docker because that risks data loss.

## Large Imports

Large product, inventory, sales, customer, supplier, and delivery imports run as background jobs.

- Uploading returns quickly with a top-of-app job tracker.
- Workers stay idle when no large action exists and wake automatically when jobs are queued.
- CSV/TSV parsing preserves Khmer text and rounds money/percent values upward to two decimals.
- Product conflicts are grouped by same name, same SKU/barcode, and errors/issues.
- Imports wait for review before applying large changes.
- Cancel, retry, failed-row download, remove, undo, and redo are available from the tracker or history tools where supported.

Keep using the app while imports run. If an import is no longer needed, remove it from the tracker so temp files and queue state can be cleaned.

## Update, Backup, Restore

Normal users should use the simple files:

- Start: `Start Business OS.bat`
- Stop: `run\stop-server.bat`
- Diagnose: `run\docker\doctor.bat`
- Backup: `run\docker\backup.bat`
- Restore: `run\docker\restore.bat`
- Update Docker release: `run\docker\update.bat`

Every user-facing command window stays open and prints what to do next.

## Cloudflare Safety

Business OS uses Cloudflare for the public/admin links. Tailscale is legacy support only and is hidden from normal setup.

If a Cloudflare tunnel token, origin private key, or API token was pasted into chat or sent to anyone, treat it as compromised:

1. Create or confirm a Cloudflare API token with Tunnel write permission.
2. Save it locally only in `ops\runtime\secrets\cloudflare-api-token.txt`.
3. Run `run\docker\rotate-cloudflare.bat --disconnect-old`.
4. Restart with **`Start Business OS.bat`**.

Technical details are in `run\README.md`, `run\docker\README.md`, and `ops\README.md`.
