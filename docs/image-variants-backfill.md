# Image variants: backfill plan for existing images (NOT RUN)

Status: plan only. Nothing here has been run; every step that writes to production R2 needs the owner's go-ahead.

## What exists after this change
- New uploads (product image upload, Library upload) carry a 320 px and a 640 px WebP made in the browser. The Worker validates and stores them at `variants/w320/<name>.webp` and `variants/w640/<name>.webp`. No Worker CPU, no Cloudflare Images quota.
- `GET /uploads/_v/w<W>/<name>` serves the stored variant (immutable, ETag, edge cache). If the variant is missing it answers a 302 to `/uploads/<name>` (max-age=300), or, while the Images quota is under 70%, transforms once and stores the result.
- Every image uploaded before this change has no variant. Those thumbnails still work (302 then the original), they just are not smaller yet.

## Why a backfill is needed
The on-demand transform shares the 5,000 per month Cloudflare Images allowance with the upload normaliser and the 6-hourly audit, and it stops spending at 70% of the image ceiling. With roughly 8-10k stored images it cannot cover the library on its own, and it never runs when the binding is absent.

## Recommended order
1. Deploy the code through the normal gated deploy (after close). From then on new uploads are covered and hot images fill in lazily.
2. Measure coverage (read-only), see below. If coverage of the images people actually see is already high after a week, stop here.
3. Only for the long tail: owner-run local backfill (below). Written and reviewed before it is run; it does not exist yet.

## Measuring (read-only)
- Originals: `SELECT COUNT(*) FROM file_assets WHERE media_type = 'image'` (remote D1, SELECT only).
- Variants: R2 listing count under `variants/w320/` against `uploads/` (the Cloudflare dashboard object count with a prefix, or a read-only `ops` list). Missing = originals minus variants.
- Quota used this month: `SELECT used FROM quota_usage WHERE resource = 'cf_images_transform' ORDER BY window_key DESC LIMIT 1`.

## Long-tail backfill (owner-run, same shape as `ops/scripts/purge-non-media-uploads.mjs`)
Design, to be written and reviewed first:
- Runs on the owner's machine, never in the Worker (no CPU limit question, no Images quota). Resizes with `sharp` installed in a throwaway folder outside the repo (never `npm install` in a worktree).
- Dry run by default: lists `uploads/` images, skips any that already have `variants/w320/<name>.webp`, prints counts. Writes only with `--write` and a typed confirmation.
- For each missing image: read the original, encode 320 and 640 WebP at quality 80, scaled by width and never enlarged (same rule as the browser and the Worker), put to `variants/w<W>/<name>.webp` with content type `image/webp`. Skip names that are not plain image names (the Worker refuses them anyway), skip GIF.
- Only ever writes under `variants/`. Never touches `uploads/`, never deletes. Idempotent: re-running skips what exists. Checkpoint file so a stop resumes.
- Cost: about 2 R2 writes and 1 read per image, so ~30k operations for 10k images, far below the 1M free monthly allowance. Output about 80 KB per image, under 1 GB in total.
- Pace: sequential with a small pause; run outside trading hours.

## Verification after a run
- Spot check 20 product images: `/uploads/_v/w320/<name>` answers 200, `content-type: image/webp`, size roughly 15-30 KB, `cache-control: public, max-age=31536000, immutable`.
- A name with no variant answers 302 to `/uploads/<name>`, never 404.
- Count of `variants/w320/` objects equals the number of eligible originals.

## Rollback
Variants are derived data. Deleting the whole `variants/` prefix is safe: every thumbnail falls back to the original through the 302. Nothing else references variant keys. Originals are never modified by any of this.

## Things deliberately left alone
- Images stored by the bulk import (ZIP of product images) and by the chunked upload Durable Object have no browser-made variant. They are covered by the lazy path and the backfill.
- Avatars and portal submissions are not product thumbnails and get no variants.
- Backups copy `uploads/` only. A restore does not bring variants back; they are regenerated lazily or by the backfill.
