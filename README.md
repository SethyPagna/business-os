# Business OS

Business OS is meant to feel like normal Windows business software: one launcher starts the app, required Docker services, workers, and Cloudflare access.

## Which File Do I Use?

Use **`Start Business OS.bat`** in the root folder.

That is the normal button. Do not open Docker Desktop, Docker Compose, Redis, Postgres, MinIO, worker, Node, npm, or Cloudflare commands yourself for everyday use.

The `run\` folder is for support, updates, backup/restore, diagnostics, and source-development tasks. The final normal runtime is the Docker release path under `run\docker\`; the old standalone Windows EXE/installer release is no longer shipped. The `ops\docker\` folder is internal configuration used by the launcher and support tools; normal users should not edit it.

## Blank Windows Laptop To Running App

Use this path for a normal business/user laptop.

1. Download or copy the **Business OS Docker portable folder** to the laptop.
2. Double-click **`Start Business OS.bat`**.
3. Business OS checks Docker Desktop and Cloudflare Tunnel (`cloudflared`).
4. If either tool is missing, Business OS tries to install it with Windows `winget`.
5. If Windows asks for administrator permission, WSL2, virtualization, or a restart, accept it. Business OS does not require you to use Linux commands; Docker Desktop may need WSL2 internally.
6. Restart Windows if Docker asks.
7. Double-click **`Start Business OS.bat`** again.
8. Wait until the window says Business OS is ready.
9. Open the URLs printed in the window.

If you are moving to a laptop that should not expose source code, use the Docker release produced by `run\build-release.bat` or `run\docker\release.bat` and published with `run\docker\publish-release.bat`. Copy the complete `release\business-os\` folder to the new laptop, then double-click the root **`Start Business OS.bat`** inside that folder. Do not copy only the `run\` folder.

What the launcher does for you:

- installs or guides Docker Desktop and Cloudflare Tunnel when Windows allows it,
- starts Docker Desktop services for the app, Redis queues/cache, Postgres, MinIO, app workers, and media workers,
- cleans stopped Business OS containers without deleting data volumes,
- pulls current Docker service images during setup,
- starts the Cloudflare connector for the public/admin links.

Normal URLs:

- Server laptop: `http://localhost:4000`
- Admin from other devices: `https://admin.leangcosmetics.dpdns.org`
- Public customer portal: `https://leangcosmetics.dpdns.org/public`

You do **not** need to run Docker Compose, Redis, Postgres, MinIO, workers, Node, npm, or Cloudflare commands by hand.

Cloudflare requires a local tunnel token file. The Docker portable folder should include it in ignored runtime secret storage, or support can create it with `run\docker\rotate-cloudflare.bat`. Never paste that token into chat or commit it to Git.

### Moving To A New Laptop With Data

1. On the old laptop, run a Business OS backup first.
2. Copy the full Business OS folder or install the new release on the new laptop.
3. Copy the newest backup folder, or choose the matching Google Drive `datasync-N` folder.
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

## Public Languages

The customer portal uses first-party language packs for fast public switching. English, Khmer, Chinese simplified/traditional, Vietnamese, Thai, Russian, French, Spanish, German, Japanese, Korean, Portuguese, Italian, Arabic, Hindi, Indonesian, Malay, and Turkish switch without loading Google Translate.

Google Translate remains only a slower fallback for unsupported languages. Business name, portal intro, and short tagline stay in the original business text instead of being auto-translated.

Fixed portal labels translate from built-in language packs. Custom content you type yourself, such as About blocks, FAQ answers, assistant text, submission instructions, social labels, and product descriptions, can use optional translation overrides in **Customer Portal > Publishing > Dynamic content translations**. This keeps edited content accurate instead of guessing a machine translation.

Example override:

```json
{
  "zh-CN": {
    "aboutTitle": "关于我们",
    "faqItems": {
      "faq-id": { "question": "问题", "answer": "答案" }
    },
    "products": {
      "123": { "description": "产品说明" }
    }
  }
}
```

## Data And Backups

Current source-runtime business data stays under:

`business-os-data\organizations\<organization-id> (<business-name>)\`

Do **not** delete `business-os-data` manually when Docker looks mismatched. It is legacy/source data only after the Docker cutover. The final Docker release does not auto-import loose folders because an old folder could overwrite newer Docker data. Use **Settings > Backup**, `run\docker\backup.bat`, `run\docker\restore.bat`, or support-guided migration instead.

Google Drive sync is managed in **Settings > Backup**. Use it as a backup/sync target, not as the only copy of the business database.

The Docker release is the no-source-code runtime path. Its required data architecture is Postgres + MinIO + Redis + DuckDB/Parquet. SQLite/local files are not an allowed Docker production mode. If a live route still imports the legacy SQLite database module, Docker startup must fail loudly instead of silently running the wrong database. `BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED` stays `0` until the full repository data-layer cutover is proven.

Final data architecture target:

- Postgres owns live products, stock, POS, sales, returns, contacts, users, roles, settings, portal, audit, history, imports, and backup metadata.
- MinIO owns uploads, product images, logos, avatars, portal/about images, file library assets, thumbnails, import media, backup assets, and Parquet snapshots.
- Redis owns durable jobs and short-lived cache.
- DuckDB/Parquet owns heavy staging and read-only workloads such as CSV import staging, conflict scans, exports, analytics snapshots, and backup verification. DuckDB is not used as the live multi-writer POS/inventory database.
- SQLite/local files are only an explicit legacy migration source, never the production Docker runtime.

### Docker Data: Copy, Restore, Update

For Docker, the live data is inside Docker-managed Postgres and MinIO volumes. Do not manually edit those volumes.

The release folder is portable without GHCR when it contains:

- `Start Business OS.bat`
- `images\business-os-image.tar`
- `ops\runtime\docker-release\docker-release.env`
- `run\docker\*.bat`

`Start Business OS.bat`, `run\docker\install.bat`, and `run\docker\start.bat` load `images\business-os-image.tar` automatically if the image is not already on the laptop. Google Drive can carry this release folder the same way as a USB drive or local copy.

Safest way to move data to another laptop:

1. On the old laptop, run `run\docker\backup.bat`.
2. Copy the newest timestamped backup folder from `ops\runtime\docker-release\backups\`, or choose the matching Google Drive `datasync-N` folder.
3. On the new laptop, copy the full `release\business-os\` folder, including `images\business-os-image.tar`.
4. Run `run\docker\restore.bat -BackupPath "C:\path\to\that\backup-folder"`.
5. Double-click **`Start Business OS.bat`** and check products, sales, files, settings, and portal content.

Backup format:

- Local backups and Google Drive `datasync-N` versions use the same folder shape.
- Each recoverable folder contains `manifest.json`, `backup.json`, `postgres.sql`, `minio.tgz`, `parquet-manifest.json`, and `checksums.sha256`.
- Docker restore validates that folder before replacing live data.
- Loose `business-os-data` folders are not restored automatically. If you are unsure which copy is newest, use backup/restore instead of copying folders.

Updating the app version does not require copying data. Run `run\docker\update.bat`; it backs up the Docker volume first, updates containers, and keeps the data volume.

## Large Imports

Large product, inventory, sales, customer, supplier, and delivery imports run as background jobs.

- Uploading returns quickly with a top-of-app job tracker.
- Workers stay idle when no large action exists and wake automatically when jobs are queued.
- CSV/TSV parsing preserves Khmer text and rounds money/percent values upward to two decimals.
- Product conflicts are grouped by same name, same SKU/barcode, and errors/issues.
- Imports wait for review before applying large changes.
- Cancel, retry, failed-row download, remove, undo, and redo are available from the tracker or history tools where supported.

Keep using the app while imports run. If an import is no longer needed, remove it from the tracker so temp files and queue state can be cleaned.

For tens of thousands of rows plus heavy image batches, the durable target is Docker Postgres + MinIO + Redis workers with DuckDB/Parquet for import staging, exports, analytics snapshots, and backup verification.

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
