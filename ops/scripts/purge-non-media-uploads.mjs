#!/usr/bin/env node
// purge-non-media-uploads.mjs -- OWNER-RUN. Deletes every stored file that
// is not an image or a video (owner ruling 2026-09-26: "delete them all").
//
// =====================================================================
//  HOW TO RUN IT (step by step, from YOUR OWN terminal)
// =====================================================================
//  Before you start: you need Node.js 18 or newer. Check with `node -v`.
//  Nothing is deleted unless you add --delete in step 5.
//
//  1. Make a Cloudflare API token (one time).
//     - Open https://dash.cloudflare.com/profile/api-tokens
//     - Click "Create Token", then "Create Custom Token".
//     - Name it: purge-uploads
//     - Permissions, add two rows:
//         Account | Workers R2 Storage | Edit
//         Account | D1                 | Edit
//     - Account Resources: Include | (your account)
//     - Click "Continue to summary", then "Create Token".
//     - Copy the token. Keep the page open until step 3 is done.
//
//  2. Open a terminal in the business-os-v1 folder (the folder that holds
//     the "ops" and "cloudflare" folders). In Windows Explorer: open that
//     folder, click the address bar, type  powershell  and press Enter.
//
//  3. Do a DRY RUN (lists and counts, changes nothing):
//         node ops/scripts/purge-non-media-uploads.mjs
//     It asks "Cloudflare API token:". Paste the token (right-click pastes
//     in PowerShell). Nothing appears while you paste; that is on purpose.
//     Press Enter.
//
//  4. Read what it printed. It shows how many files it would KEEP and how
//     many it would DELETE, per kind, and the folder where it saved the
//     full list (manifest.json). Open that file if you want to see every
//     file name. If the numbers look wrong, STOP and send the printout.
//
//  5. Delete for real:
//         node ops/scripts/purge-non-media-uploads.mjs --delete
//     Paste the token again. It saves a fresh list first, then asks you
//     to type DELETE to confirm. Type DELETE (capitals) and press Enter.
//     Deleted files cannot be brought back; the saved list records them.
//
//  6. When it prints "Done", send the last lines of the printout. You can
//     then delete the token on the API tokens page (it is not needed again).
//
//  If anything prints "FAILED", nothing further is changed; send the
//  printout. Running it again is safe: it starts over from what is left.
// =====================================================================
//
// What it does
//   (a) Lists every object in R2 bucket business-os-assets under uploads/,
//       private/ and imports/ through the Cloudflare API, with the token you
//       paste (read from a hidden prompt, or from CLOUDFLARE_API_TOKEN if
//       that is already set). The token is never printed or written.
//   (b) Classifies each object from its bytes and name:
//         keep   = a JPEG/PNG/WebP/GIF/AVIF image or an MP4/MOV/WebM video
//                  (bytes AND file extension agree it is media; an image
//                  must carry no HTML/script markup);
//         keep   = an older photo format (HEIC/BMP/TIFF) -- not an XSS risk,
//                  counted separately so the owner can decide later;
//         delete = everything else (PDF, CSV, XLSX, ZIP, HTML, SVG, text,
//                  a media file named .html, an image hiding a script).
//       Everything under imports/ is a temporary import file and is deleted,
//       unless it belongs to an import that is still running or waiting
//       for review.
//   (c) Writes manifest.json first: key, size, type, decision, and the
//       matching file_assets / import_job_files row ids.
//   (d) Without --delete: dry run, prints counts only. With --delete: after
//       you type DELETE, deletes the objects, then updates D1 through a SQL
//       file (d1-changes.sql, saved next to the manifest) whose guard
//       statements refuse to run unless the row counts are exactly what the
//       manifest expects, and checks the counts again afterwards:
//         - file_assets rows of deleted Library files are removed (their
//           import_job_files links are cleared first);
//         - import_job_files rows of deleted files are marked 'purged'.
//
// Read-only on anything else. It never touches objects outside the three
// prefixes (backups, exports, etc.). Written for the owner's terminal
// because Claude-launched processes cannot reach the Cloudflare API
// reliably through the VPN.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

export const BUCKET = 'business-os-assets'
export const PREFIXES = ['uploads/', 'private/', 'imports/']
const API = 'https://api.cloudflare.com/client/v4'
const HEAD_BYTES = 4096
// Images up to this size are read whole so hidden markup is found anywhere.
const FULL_SCAN_MAX_BYTES = 25 * 1024 * 1024

// ---------------------------------------------------------------- classify
// Mirrors cloudflare/src/lib/uploadSecurity.ts (detectUploadFormat,
// containsEmbeddedMarkup) so the purge keeps exactly what the Worker would
// accept today.
const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.mp4', '.mov', '.webm'])
const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'])
const POLYGLOT_TAGS = ['<script', '<html', '<svg', '<iframe', '<body', '<object', '<embed', '<!doctype html', '<meta', '<img', '<a href', 'javascript:']
// Jobs whose incoming file must survive (same set as the Worker's
// lib/importIncomingFiles.ts IMPORT_ACTIVE_STATUSES).
export const ACTIVE_JOB_STATUSES = ['pending', 'created', 'queued', 'analyzing', 'running', 'awaiting_review', 'approved', 'applying', 'cancelling']

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)))
const startsWith = (bytes, sig) => bytes.length >= sig.length && sig.every((value, index) => bytes[index] === value)

export function detectFormat(bytes) {
  if (!bytes || !bytes.length) return null
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png' }
  const gif = ascii(bytes, 0, 6)
  if (gif === 'GIF87a' || gif === 'GIF89a') return { kind: 'image', mime: 'image/gif' }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { kind: 'image', mime: 'image/webp' }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm' }
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12).toLowerCase()
    if (brand === 'avif' || brand === 'avis') return { kind: 'image', mime: 'image/avif' }
    if (HEIF_BRANDS.has(brand)) return { kind: 'legacy-image', mime: 'image/heic' }
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime' }
    return { kind: 'video', mime: 'video/mp4' }
  }
  // Older photo formats: not on the upload list any more, but a photo, not
  // a script -- kept and counted apart.
  if (ascii(bytes, 0, 2) === 'BM' && bytes.length >= 26 && bytes[14] >= 12 && bytes[14] <= 124 && bytes[15] === 0) return { kind: 'legacy-image', mime: 'image/bmp' }
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return { kind: 'legacy-image', mime: 'image/tiff' }
  return null
}

export function containsMarkup(bytes) {
  const lower = (byte) => (byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte)
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]
    if (byte !== 0x3c && byte !== 0x6a && byte !== 0x4a) continue
    outer: for (const tag of POLYGLOT_TAGS) {
      if (lower(byte) !== tag.charCodeAt(0) || index + tag.length > bytes.length) continue
      for (let offset = 1; offset < tag.length; offset += 1) {
        if (lower(bytes[index + offset]) !== tag.charCodeAt(offset)) continue outer
      }
      if (tag.startsWith('<')) {
        const next = bytes[index + tag.length]
        if (next !== undefined && ![0x20, 0x3e, 0x2f, 0x09, 0x0a, 0x0d].includes(next)) continue
      }
      return true
    }
  }
  return false
}

export function extensionOf(key) {
  const name = String(key).split('/').pop() || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export function jobIdOfImportKey(key) {
  const match = /^imports\/([^/]+)\//.exec(String(key))
  return match ? match[1] : null
}

// Returns { decision: 'keep'|'delete', category, type }.
//   bytes     -- the first HEAD_BYTES (or the whole image, see scanWhole)
//   fullScan  -- true when `bytes` is the whole object
export function classifyObject({ key, bytes, fullScan, activeJobIds }) {
  if (key.startsWith('imports/')) {
    const jobId = jobIdOfImportKey(key)
    if (jobId && activeJobIds.has(jobId)) return { decision: 'keep', category: 'import-file-of-running-job', type: detectFormat(bytes)?.mime || 'unknown' }
    return { decision: 'delete', category: 'import-file', type: detectFormat(bytes)?.mime || 'unknown' }
  }
  const format = detectFormat(bytes)
  const ext = extensionOf(key)
  if (!format) return { decision: 'delete', category: 'not-media', type: 'unknown' }
  if (format.kind === 'legacy-image') {
    if (containsMarkup(bytes)) return { decision: 'delete', category: 'image-with-markup', type: format.mime }
    return { decision: 'keep', category: 'legacy-image', type: format.mime }
  }
  // Served by its extension (lib/r2.ts): media bytes under a non-media name
  // (evil.html) are not safe to keep.
  if (!MEDIA_EXTENSIONS.has(ext)) return { decision: 'delete', category: 'media-bytes-wrong-extension', type: format.mime }
  if (format.kind === 'image' && containsMarkup(bytes)) return { decision: 'delete', category: 'image-with-markup', type: format.mime }
  if (format.kind === 'image' && !fullScan) return { decision: 'keep', category: 'image-large-header-checked', type: format.mime }
  return { decision: 'keep', category: format.kind, type: format.mime }
}

// ------------------------------------------------------------------- SQL
const safeIds = (ids) => {
  for (const id of ids) if (!Number.isSafeInteger(id) || id < 0) throw new Error('refusing a non-integer row id')
  return [...new Set(ids)].sort((a, b) => a - b)
}
const chunk = (items, size) => {
  const out = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}
// A guard statement: evaluates json('') (malformed JSON -> error) and so
// aborts the file unless `countSql` equals `expected`.
const guard = (label, countSql, expected) =>
  `-- guard: ${label} must be ${expected}\nSELECT CASE WHEN (${countSql}) = ${expected} THEN 1 ELSE json('guard failed: ${label}') END AS guard;`

export function buildD1Sql({ fileAssetIds, importFileIds }) {
  const assets = safeIds(fileAssetIds)
  const importFiles = safeIds(importFileIds)
  const inList = (ids) => ids.join(', ')
  const lines = ['-- purge-non-media-uploads.mjs D1 changes. Generated; do not edit.']
  const assetCount = (ids) => `SELECT COUNT(*) FROM file_assets WHERE id IN (${inList(ids)})`
  const fileCount = (ids, purged) => `SELECT COUNT(*) FROM import_job_files WHERE id IN (${inList(ids)})${purged ? " AND status = 'purged'" : ''}`
  const pre = []
  const change = []
  const post = []
  for (const ids of chunk(assets, 400)) {
    pre.push(guard('file_assets rows present before', assetCount(ids), ids.length))
    change.push(`UPDATE import_job_files SET file_asset_id = NULL, status = 'purged', updated_at = CURRENT_TIMESTAMP WHERE file_asset_id IN (${inList(ids)});`)
    change.push(`DELETE FROM file_assets WHERE id IN (${inList(ids)});`)
    post.push(guard('file_assets rows left after', assetCount(ids), 0))
  }
  for (const ids of chunk(importFiles, 400)) {
    pre.push(guard('import_job_files rows present before', fileCount(ids, false), ids.length))
    change.push(`UPDATE import_job_files SET status = 'purged', updated_at = CURRENT_TIMESTAMP WHERE id IN (${inList(ids)});`)
    post.push(guard('import_job_files rows purged after', fileCount(ids, true), ids.length))
  }
  if (!change.length) return null
  return [...lines, '-- pre-assertions', ...pre, '-- changes', ...change, '-- post-assertions', ...post, ''].join('\n')
}

// ------------------------------------------------------------ Cloudflare
function readWranglerIds() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const tomlPath = path.resolve(here, '..', '..', 'cloudflare', 'wrangler.toml')
  const text = fs.readFileSync(tomlPath, 'utf8')
  const accountId = /^account_id\s*=\s*"([0-9a-f]{32})"/m.exec(text)?.[1]
  const dbBlock = /database_name\s*=\s*"business-os"\s*\r?\ndatabase_id\s*=\s*"([0-9a-f-]{36})"/.exec(text)?.[1]
  return { accountId, databaseId: dbBlock }
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = function writeToOutput(text) {
      // Show the question, hide whatever is typed or pasted.
      if (text.includes(question)) rl.output.write(text)
    }
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()) })
  })
}
function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()) })
  })
}

function makeClient(token, accountId, databaseId) {
  const headers = { Authorization: `Bearer ${token}` }
  const r2Base = `${API}/accounts/${accountId}/r2/buckets/${BUCKET}/objects`
  async function json(url, init = {}) {
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers || {}) } })
    const body = await response.json().catch(() => null)
    if (!response.ok || body?.success === false) {
      const reason = body?.errors?.map((error) => `${error.code}: ${error.message}`).join('; ') || `HTTP ${response.status}`
      throw new Error(`Cloudflare API refused ${init.method || 'GET'} ${url.replace(API, '')}: ${reason}`)
    }
    return body
  }
  return {
    async listObjects(prefix) {
      const objects = []
      let cursor = ''
      for (;;) {
        const query = new URLSearchParams({ prefix, per_page: '1000' })
        if (cursor) query.set('cursor', cursor)
        const body = await json(`${r2Base}?${query}`)
        const page = Array.isArray(body.result) ? body.result : body.result?.objects || []
        for (const object of page) objects.push({ key: object.key, size: Number(object.size || 0), uploaded: object.last_modified || object.uploaded || null })
        const info = body.result_info || {}
        cursor = info.cursor || body.result?.cursor || ''
        const truncated = info.is_truncated ?? body.result?.truncated ?? Boolean(cursor && page.length)
        if (!truncated || !cursor) break
      }
      return objects
    },
    // First `limit` bytes of an object (the stream is cancelled after).
    async readHead(key, limit) {
      const response = await fetch(`${r2Base}/${encodeURIComponent(key)}`, { headers: { ...headers, Range: `bytes=0-${limit - 1}` } })
      if (!response.ok) throw new Error(`could not read ${key}: HTTP ${response.status}`)
      const reader = response.body.getReader()
      const parts = []
      let total = 0
      while (total < limit) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        total += value.length
      }
      await reader.cancel().catch(() => {})
      const out = new Uint8Array(Math.min(total, limit))
      let offset = 0
      for (const part of parts) {
        const slice = part.subarray(0, Math.min(part.length, out.length - offset))
        out.set(slice, offset)
        offset += slice.length
        if (offset >= out.length) break
      }
      return out
    },
    async deleteObject(key) {
      await json(`${r2Base}/${encodeURIComponent(key)}`, { method: 'DELETE' })
    },
    async d1(sql, params = []) {
      const body = await json(`${API}/accounts/${accountId}/d1/database/${databaseId}/query`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql, params }),
      })
      return body.result
    },
  }
}

const rowsOf = (result) => (Array.isArray(result) ? result.flatMap((statement) => statement?.results || []) : [])

// ------------------------------------------------------------------ main
async function main() {
  const doDelete = process.argv.includes('--delete')
  const fromToml = (() => { try { return readWranglerIds() } catch { return {} } })()
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || fromToml.accountId
  const databaseId = process.env.BUSINESS_OS_D1_DATABASE_ID || fromToml.databaseId
  if (!accountId || !databaseId) {
    console.error('FAILED: could not read the account id / database id from cloudflare/wrangler.toml. Run this from the business-os-v1 folder.')
    process.exit(1)
  }
  const token = process.env.CLOUDFLARE_API_TOKEN || await promptHidden('Cloudflare API token: ')
  if (!token) { console.error('FAILED: no token given.'); process.exit(1) }
  const cf = makeClient(token, accountId, databaseId)

  console.log(doDelete ? 'Mode: DELETE (asks before changing anything)' : 'Mode: DRY RUN (changes nothing)')
  console.log('Reading the database (read-only)...')
  const activeJobIds = new Set(rowsOf(await cf.d1(
    `SELECT id FROM import_jobs WHERE status IN (${ACTIVE_JOB_STATUSES.map(() => '?').join(', ')})`, ACTIVE_JOB_STATUSES,
  )).map((row) => String(row.id)))
  const assetRows = rowsOf(await cf.d1('SELECT id, stored_name, public_path FROM file_assets'))
  const jobFileRows = rowsOf(await cf.d1("SELECT id, job_id, stored_path, file_asset_id FROM import_job_files WHERE stored_path LIKE 'uploads/%' OR stored_path LIKE 'private/%' OR stored_path LIKE 'imports/%'"))
  const assetsByKey = new Map()
  for (const row of assetRows) {
    const keys = new Set()
    const publicPath = String(row.public_path || '')
    if (publicPath.startsWith('/uploads/')) keys.add(publicPath.slice(1))
    if (row.stored_name) { keys.add(`uploads/${row.stored_name}`); keys.add(`private/library/${row.stored_name}`) }
    for (const key of keys) {
      if (!assetsByKey.has(key)) assetsByKey.set(key, [])
      assetsByKey.get(key).push(Number(row.id))
    }
  }
  const jobFilesByKey = new Map()
  for (const row of jobFileRows) {
    const key = String(row.stored_path)
    if (!jobFilesByKey.has(key)) jobFilesByKey.set(key, [])
    jobFilesByKey.get(key).push(Number(row.id))
  }

  console.log('Listing and checking stored files...')
  const entries = []
  let checked = 0
  for (const prefix of PREFIXES) {
    const objects = await cf.listObjects(prefix)
    for (const object of objects) {
      const likelyImage = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?|heic|heif)$/i.test(object.key)
      const fullScan = likelyImage && object.size > 0 && object.size <= FULL_SCAN_MAX_BYTES
      const bytes = object.size > 0 ? await cf.readHead(object.key, fullScan ? object.size : HEAD_BYTES) : new Uint8Array(0)
      const verdict = classifyObject({ key: object.key, bytes, fullScan: fullScan || object.size <= HEAD_BYTES, activeJobIds })
      entries.push({
        key: object.key, size: object.size, uploaded: object.uploaded, type: verdict.type,
        decision: verdict.decision, category: verdict.category,
        file_asset_ids: assetsByKey.get(object.key) || [],
        import_job_file_ids: jobFilesByKey.get(object.key) || [],
      })
      checked += 1
      if (checked % 200 === 0) console.log(`  ...${checked} checked`)
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = path.join(os.homedir(), 'business-os-purge', stamp)
  fs.mkdirSync(outDir, { recursive: true })
  const manifestPath = path.join(outDir, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify({ bucket: BUCKET, prefixes: PREFIXES, mode: doDelete ? 'delete' : 'dry-run', createdAt: new Date().toISOString(), entries }, null, 2))

  const counts = {}
  for (const entry of entries) {
    const label = `${entry.decision.toUpperCase()} ${entry.category}`
    counts[label] = counts[label] || { files: 0, bytes: 0 }
    counts[label].files += 1
    counts[label].bytes += entry.size
  }
  const toDelete = entries.filter((entry) => entry.decision === 'delete')
  console.log('')
  for (const label of Object.keys(counts).sort()) console.log(`  ${label.padEnd(44)} ${String(counts[label].files).padStart(6)} files  ${(counts[label].bytes / 1048576).toFixed(1)} MB`)
  console.log(`  Library rows linked to files to delete: ${new Set(toDelete.flatMap((entry) => entry.file_asset_ids)).size}`)
  console.log(`  Import rows linked to files to delete:  ${new Set(toDelete.flatMap((entry) => entry.import_job_file_ids)).size}`)
  console.log(`\nFull list saved: ${manifestPath}`)

  if (!doDelete) {
    console.log('\nDry run finished. Nothing was changed. To delete, run again with --delete.')
    return
  }
  if (!toDelete.length) { console.log('\nNothing to delete. Done.'); return }
  const answer = await prompt(`\nType DELETE to permanently delete ${toDelete.length} files: `)
  if (answer !== 'DELETE') { console.log('Not confirmed. Nothing was changed.'); return }

  const deleted = []
  const failed = []
  for (const entry of toDelete) {
    try { await cf.deleteObject(entry.key); deleted.push(entry) } catch (error) { failed.push({ key: entry.key, error: String(error.message || error) }) }
    if ((deleted.length + failed.length) % 100 === 0) console.log(`  ...${deleted.length + failed.length} of ${toDelete.length}`)
  }
  fs.writeFileSync(path.join(outDir, 'deleted.json'), JSON.stringify({ deleted: deleted.map((entry) => entry.key), failed }, null, 2))
  console.log(`Deleted ${deleted.length} files${failed.length ? `; FAILED to delete ${failed.length} (listed in deleted.json)` : ''}.`)

  // D1: only rows whose file really was deleted.
  const fileAssetIds = [...new Set(deleted.flatMap((entry) => entry.file_asset_ids))]
  const deletedAssetSet = new Set(fileAssetIds)
  const importFileIds = [...new Set(deleted.flatMap((entry) => entry.import_job_file_ids))]
    .filter((id) => !jobFileRows.some((row) => Number(row.id) === id && deletedAssetSet.has(Number(row.file_asset_id))))
  const sql = buildD1Sql({ fileAssetIds, importFileIds })
  if (!sql) { console.log('No database rows to change. Done.'); return }
  const sqlPath = path.join(outDir, 'd1-changes.sql')
  fs.writeFileSync(sqlPath, sql)
  console.log(`Database changes saved: ${sqlPath}`)
  try {
    await cf.d1(sql)
  } catch (error) {
    console.error(`FAILED: the database changes were refused (${error.message}).`)
    console.error('The files above are already deleted; the database was not changed by the refused step. Send this printout.')
    process.exit(1)
  }
  // Post-check read back independently of the file's own guards.
  const leftAssets = fileAssetIds.length ? rowsOf(await cf.d1(`SELECT COUNT(*) AS n FROM file_assets WHERE id IN (${fileAssetIds.join(', ')})`))[0]?.n : 0
  if (Number(leftAssets || 0) !== 0) { console.error(`FAILED: ${leftAssets} Library rows are still present.`); process.exit(1) }
  console.log(`Removed ${fileAssetIds.length} Library rows; marked ${importFileIds.length} import rows purged.`)
  console.log('Done.')
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main().catch((error) => {
    // Never echo the token: error messages here come from the API or fs.
    console.error(`FAILED: ${String(error?.message || error)}`)
    process.exit(1)
  })
}
