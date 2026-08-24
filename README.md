# Business OS

Business OS is a POS / inventory / e-commerce admin system. It runs entirely
on Cloudflare — Workers (API), D1 (database), R2 (files/media), Queues
(background jobs), and KV (cache). There is no local server, no Docker, and
no separate backend process: `cloudflare/` **is** the backend, and it is
always deployed and always on.

- Admin app: `https://admin.leangcosmetics.dpdns.org`
- Public customer portal: `https://leangcosmetics.dpdns.org`

For step-by-step install/deploy/redeploy instructions, see **[DEPLOY.md](./DEPLOY.md)**.

## Architecture

| Concern | Service |
|---|---|
| API + serving the built frontend | Cloudflare Workers (`cloudflare/`, Hono) |
| Database (products, sales, users, settings, etc.) | Cloudflare D1 |
| File/image/video storage | Cloudflare R2 |
| Background jobs (imports, media processing) | Cloudflare Queues |
| Cache | Cloudflare KV |
| Frontend | React + TypeScript, built to static assets and served by the Worker |

`frontend/` builds to `frontend/dist`, which the Worker serves directly
(`[assets]` in `cloudflare/wrangler.toml`) — API/upload/health routes run
Worker code first, everything else falls back to the single-page app.

## Repo layout

- `frontend/` — React/TypeScript admin + portal UI. Build with `npm run build`.
- `cloudflare/` — the Worker: routes, D1 migrations, R2/Queues/KV integration.
  See `cloudflare/README.md` for its own quick-start.
- `ops/scripts/powershell/full-automation.ps1` — one-command release pipeline
  (typecheck -> build -> migrate -> deploy -> health check).
- `run/full-automation.bat` — Windows entry point for the script above.
- `run/open-app.bat` — opens the live admin URL (there's nothing to "start" locally).

There is no `backend/`, `ops/docker/`, or `run/docker/` folder anymore - those
held the retired self-hosted Docker/Postgres stack and have been removed.
`PORTING_STATUS.md` and `CHANGES-VERIFIED.md` are the historical record of
that migration.

## Data model

- **D1** owns products, stock, POS, sales, returns, contacts, users, roles,
  settings, portal content, audit history, and import job metadata.
- **R2** owns uploads, product images, logos, avatars, portal/about images,
  file library assets, thumbnails, import media, and backup assets.
- **Queues** run large imports (products, inventory, sales, contacts) and
  media optimization as background jobs so the UI never blocks on them.
- **KV** is a short-lived cache in front of D1 for hot read paths.

Images are normalized through a media optimizer before storage: compressible
formats are resized/recompressed to fit a 40KB budget; formats that can't
meet that are rejected with a clear upload error. Videos are recompressed
(H.264, CRF 24, 96k AAC, 1280px max edge, fast-start).

## Public languages

The customer portal ships first-party language packs for instant switching:
English, Khmer, Chinese (simplified/traditional), Vietnamese, Thai, Russian,
French, Spanish, German, Japanese, Korean, Portuguese, Italian, Arabic,
Hindi, Indonesian, Malay, and Turkish. Business name, portal intro, and
tagline stay in the original business text.

## Large imports

Product, inventory, sales, customer, supplier, and delivery-contact imports
run as background jobs via Cloudflare Queues:

- Pick a file with the file picker, or download the CSV template and fill it
  in — every import screen shows the exact columns and previews the parsed
  rows before you confirm (no paste-a-blob-of-CSV-text step).
- CSV/TSV parsing preserves Khmer text and rounds money/percent values to two
  decimals.
- Conflicts are grouped by matching name, SKU/barcode, or validation errors.
- Barcodes exported as spreadsheet scientific notation (e.g. `8.19265E+11`)
  are blocked during review until fixed.
- Imports wait for review before applying large changes; cancel, retry,
  failed-row download, and undo/redo are available where supported.
- Every import action (create, upload, start, cancel, retry, approve,
  delete) is recorded in the audit log.

## Security notes

If a Cloudflare API token, D1/R2 credential, or app secret was ever pasted
into chat, email, or a screenshot, treat it as compromised and rotate it in
the Cloudflare dashboard immediately. Real secrets belong only in
`wrangler secret put` / the Cloudflare dashboard's environment variables —
never in tracked files.

## Support docs

- `DEPLOY.md` — install, deploy, and redeploy steps.
- `cloudflare/README.md` — Worker-specific quick start and resource setup.
- `PORTING_STATUS.md` — historical log of the Docker -> Cloudflare migration.
- `CHANGES-VERIFIED.md` — verified fix/change log.
