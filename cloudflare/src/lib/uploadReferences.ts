import type { D1Compat } from './db'

// The ONE answer to "is this Library upload still referenced anywhere?"
// (U-profile3, 27 Sep 2026).
//
// Before this, each caller counted references its own way and only in the
// canonical form (`/uploads/NAME`, exact): the avatar replace/remove routes
// deleted a photo that a promotion still showed as `uploads/NAME` (no leading
// slash), `/uploads/NAME?v=3`, or `https://host/uploads/NAME`, and the Library
// delete missed several of those forms too. Every stored reference is now
// normalised the same way before it is compared:
//   - scheme + host are ignored (`https://admin.example.com/uploads/NAME`);
//   - the leading slash is optional (`uploads/NAME`);
//   - a query string or hash is ignored (`?v=3`, `#x`);
//   - percent-encoding is decoded (`uploads/My%20Photo.png`), including an
//     encoded separator (`uploads%2FNAME`) and `+` for a space;
//   - JSON-escaped slashes are unescaped (`"\/uploads\/NAME"`);
//   - a variant URL (`/uploads/_v/w320/NAME`) references its original.
// A literal occurrence of the canonical path always counts as well, so a
// legacy file whose stored name itself contains `?` or `#` is never missed.
//
// Matching errs on the side of "referenced": a false positive only keeps a
// file (and the Library's typed CONFIRM DELETE override still exists for a
// deliberate delete); a false negative loses one.
//
// Every column that can hold an upload path, found by walking the writers:
//   users.avatar_path                       -- avatar routes, admin + profile forms
//   products.image_path                     -- product writes, imports, stock sessions (active or not)
//   product_images.image_path               -- product gallery writes
//   products.description, products.custom_fields -- free text / JSON that can embed an image URL
//   promotions.image_path, promotions.link_url   -- free-text promotion fields
//   settings.value                          -- store/portal/receipt logos and JSON documents
//   customer_share_submissions.screenshots_json -- legacy `/uploads/...` screenshots
//   import_job_image_matches.image_path     -- a pending import's matched product photos
//   import_job_files.stored_path / file_asset_id -- files of an import job that has not finished
//   pending_actions.payload_json            -- an OPEN review-queue write that may carry a path
// Deliberately NOT scanned: undo/redo payloads (action_history,
// undo_snapshots) and audit rows -- history, not a live use; scanning them
// would pin every file ever touched.

export type UploadReferenceAsset = {
  id?: number | null
  stored_name?: string | null
  public_path?: string | null
}

export type UploadUsage = {
  products: number
  gallery: number
  avatars: number
  promotions: number
  settings: number
  descriptions: number
  submissions: number
  imports: number
  pending: number
  total: number
}

type UsageKey = Exclude<keyof UploadUsage, 'total'>

type ReferenceSource = {
  key: UsageKey
  table: string
  columns: string[]
  // Extra SQL filter (no parameters) applied on top of the token prefilter.
  where?: string
  // A column holding the file_assets id itself (a direct link, no path).
  assetIdColumn?: string
}

const TERMINAL_IMPORT_STATUS_SQL = `('completed', 'completed_with_errors', 'failed', 'cancelled')`

export const UPLOAD_REFERENCE_SOURCES: readonly ReferenceSource[] = [
  { key: 'avatars', table: 'users', columns: ['avatar_path'] },
  { key: 'products', table: 'products', columns: ['image_path'] },
  { key: 'gallery', table: 'product_images', columns: ['image_path'] },
  { key: 'descriptions', table: 'products', columns: ['description', 'custom_fields'] },
  { key: 'promotions', table: 'promotions', columns: ['image_path', 'link_url'] },
  { key: 'settings', table: 'settings', columns: ['value'] },
  { key: 'submissions', table: 'customer_share_submissions', columns: ['screenshots_json'] },
  { key: 'imports', table: 'import_job_image_matches', columns: ['image_path'] },
  {
    key: 'imports',
    table: 'import_job_files',
    columns: ['stored_path'],
    assetIdColumn: 'file_asset_id',
    where: `NOT EXISTS (SELECT 1 FROM import_jobs j WHERE j.id = import_job_files.job_id AND j.status IN ${TERMINAL_IMPORT_STATUS_SQL})`,
  },
  { key: 'pending', table: 'pending_actions', columns: ['payload_json'], where: `status = 'open'` },
]

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch (_) {
    try {
      return decodeURI(value)
    } catch (_) {
      return value
    }
  }
}

// The names an asset can be referred to by: its stored name and the name its
// public path carries (identical for every current writer; a legacy row may
// differ), each raw and decoded.
export function uploadAssetNames(asset: UploadReferenceAsset): string[] {
  const names = new Set<string>()
  const add = (value: unknown) => {
    const raw = String(value || '').trim()
    if (!raw) return
    names.add(raw)
    names.add(safeDecode(raw))
  }
  add(asset.stored_name)
  const publicPath = String(asset.public_path || '').trim()
  const fromPath = publicPath.replace(/^\/+/, '').replace(/^uploads\/+/, '')
  if (fromPath && fromPath !== publicPath.replace(/^\/+/, '')) add(fromPath)
  names.delete('')
  return [...names]
}

const UPLOAD_SEGMENT = /(?:^|[^A-Za-z0-9_~.-])uploads\/+([^\s"'<>?#\\]+)/gi
const TRAILING_PUNCTUATION = /[)\]},;:!.]+$/

// Every upload name a stored value refers to, normalised (see the header).
export function extractUploadReferenceNames(value: unknown): string[] {
  const text = String(value ?? '')
  if (!text) return []
  const unescaped = text.replace(/\\\//g, '/')
  const decodedText = safeDecode(unescaped.replace(/\+/g, ' '))
  const found = new Set<string>()
  for (const haystack of new Set([unescaped, safeDecode(unescaped), decodedText])) {
    for (const match of haystack.matchAll(UPLOAD_SEGMENT)) {
      const captured = match[1]
      for (const candidate of [captured, safeDecode(captured), safeDecode(captured.replace(/\+/g, ' '))]) {
        found.add(candidate)
        const trimmed = candidate.replace(TRAILING_PUNCTUATION, '')
        if (trimmed) found.add(trimmed)
      }
    }
  }
  return [...found]
}

// True when `value` (a path, URL, JSON document or free text) refers to the
// asset in any of the normalised forms.
export function valueReferencesUpload(value: unknown, asset: UploadReferenceAsset): boolean {
  const text = String(value ?? '')
  if (!text) return false
  const names = uploadAssetNames(asset)
  if (!names.length) return false
  const publicPath = String(asset.public_path || '').trim()
  if (publicPath && text.includes(publicPath)) return true
  for (const name of names) {
    if (text.includes(`uploads/${name}`)) return true
  }
  const nameSet = new Set(names)
  for (const reference of extractUploadReferenceNames(text)) {
    if (nameSet.has(reference)) return true
    const lastSlash = reference.lastIndexOf('/')
    if (lastSlash >= 0 && nameSet.has(reference.slice(lastSlash + 1))) return true
    for (const name of names) {
      if (name.includes('/') && reference.endsWith(`/${name}`)) return true
    }
  }
  return false
}

const UNRESERVED_TAIL = /[A-Za-z0-9._~-]+$/
const MIN_TAIL_TOKEN_LENGTH = 12

// Substrings that every stored form of a reference must contain verbatim, so
// SQL can narrow each table with instr() before the exact comparison runs in
// code. Unreserved characters are never percent-encoded, so the unreserved
// tail of a stored name (`-1727400000000-ab12cd34.webp` for every current
// writer) survives every encoding; a name without a long enough tail falls
// back to its raw and encoded spellings.
export function uploadReferenceSearchTokens(asset: UploadReferenceAsset): string[] {
  const tokens = new Set<string>()
  for (const name of uploadAssetNames(asset)) {
    const lastSegment = name.slice(name.lastIndexOf('/') + 1)
    const tail = UNRESERVED_TAIL.exec(lastSegment)?.[0] || ''
    if (tail.length >= MIN_TAIL_TOKEN_LENGTH) {
      tokens.add(tail)
      continue
    }
    const encoded = encodeURIComponent(lastSegment)
    tokens.add(lastSegment)
    tokens.add(encoded)
    tokens.add(encoded.replace(/%[0-9A-F]{2}/g, (hex) => hex.toLowerCase()))
    tokens.add(encodeURI(lastSegment))
    if (lastSegment.includes(' ')) tokens.add(lastSegment.replace(/ /g, '+'))
  }
  tokens.delete('')
  return [...tokens]
}

function emptyUsage(): UploadUsage {
  return { products: 0, gallery: 0, avatars: 0, promotions: 0, settings: 0, descriptions: 0, submissions: 0, imports: 0, pending: 0, total: 0 }
}

// Counts, per source, the rows that still reference the asset. Every table
// in UPLOAD_REFERENCE_SOURCES is read; one instr() prefilter per column
// keeps each read to the handful of rows that can match.
export async function findUploadReferences(db: D1Compat, asset: UploadReferenceAsset): Promise<UploadUsage> {
  const usage = emptyUsage()
  const tokens = uploadReferenceSearchTokens(asset)
  const assetId = Number(asset.id || 0)
  if (!tokens.length && !assetId) return usage
  const params: Record<string, string | number> = {}
  tokens.forEach((token, index) => { params[`token${index}`] = token })
  params.assetId = assetId

  for (const source of UPLOAD_REFERENCE_SOURCES) {
    const tokenTerms = source.columns.flatMap((column) => tokens.map((_, index) => `instr(${column}, @token${index}) > 0`))
    if (source.assetIdColumn && assetId) tokenTerms.push(`${source.assetIdColumn} = @assetId`)
    if (!tokenTerms.length) continue
    const selected = [...source.columns, ...(source.assetIdColumn ? [source.assetIdColumn] : [])]
    const rows = await db.prepare(`
      SELECT ${selected.join(', ')} FROM ${source.table}
      WHERE (${tokenTerms.join(' OR ')})${source.where ? ` AND ${source.where}` : ''}
    `).all<Record<string, unknown>>(params)
    for (const row of rows) {
      const linked = source.assetIdColumn && assetId && Number(row[source.assetIdColumn] || 0) === assetId
      if (linked || source.columns.some((column) => valueReferencesUpload(row[column], asset))) usage[source.key] += 1
    }
  }
  usage.total = usage.products + usage.gallery + usage.avatars + usage.promotions + usage.settings
    + usage.descriptions + usage.submissions + usage.imports + usage.pending
  return usage
}

export async function isUploadReferenced(db: D1Compat, asset: UploadReferenceAsset): Promise<boolean> {
  return (await findUploadReferences(db, asset)).total > 0
}
