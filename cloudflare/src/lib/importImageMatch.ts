// Best-fit image <-> product matching for the bulk import flow.
//
// WHY THIS EXISTS: `importEngine.ts` imports `normalizeImageMatchKey`,
// `MAX_IMAGES_PER_PRODUCT`, `matchImagesToProducts`, and
// `buildAutoRenamePlan` from this module -- but this file did not exist
// anywhere in the tar (confirmed via grep before writing this: zero
// definitions, one import site). That's a dead import exactly like the
// `zipReader.ts` gap documented earlier in CHANGES-VERIFIED.md: it's not a
// missing *feature* so much as a missing *file*, and it was failing
// `tsc --noEmit` outright (`Cannot find module './importImageMatch'`).
// This is the real implementation, not a stub -- it's what makes every
// image-matching behavior described in `importEngine.ts`'s comments
// (exact-key match, fuzzy best-fit fallback, per-product image limit,
// operator overrides, auto-rename) actually work end to end.
//
// SCOPE: this module only *decides* matches/scores/rename targets. It
// never touches R2 objects or the database directly -- `importEngine.ts`
// and `routes/importJobs.ts` own all persistence. Renaming here means
// picking a new *display* name (`import_job_files.original_name` /
// `file_assets.original_name`); the underlying R2 object key is left
// alone deliberately -- rewriting live object keys on every re-analyze
// (this runs on every `analyze`, not just `apply`) would mean re-writing
// storage on every keystroke of a CSV edit, for a purely cosmetic rename.

export type UploadedImageRef = {
  id: number
  originalName: string
  relativePath: string | null
  publicPath: string
}

export type MatchCandidateProduct = {
  id: number | string
  name: string
}

export type MatchEntry = {
  image: UploadedImageRef
  productId: number | string
  productName: string
  score: number
  matchType: 'exact' | 'fuzzy'
}

export type ImageMatchSummary = {
  matched: MatchEntry[]
  unmatched: UploadedImageRef[]
  overLimit: Array<{
    productId: number | string
    productName: string
    limit: number
    all: MatchEntry[]
    winners: MatchEntry[]
  }>
}

// Same cap on both sides of the review UI (BulkImportModal.tsx's
// "Too many images for one product" panel) and the product form
// (`catalog.ts`/`products.ts` gallery cap) -- keeps a bulk-imported
// gallery from silently exceeding what a hand-edited product gallery
// would ever have. Lowered from 5 to 3 per explicit user direction
// (applies uniformly to every product row, including each "child row"/
// variant in a group -- a variant is just another product row, so it
// goes through this exact same cap already; no separate per-variant
// limit needed).
export const MAX_IMAGES_PER_PRODUCT = 3

// A fuzzy match below this score is treated as no match at all -- better
// to leave an image "unmatched" (operator can still hand-assign it via
// /:id/images/assign) than to silently attach it to the wrong product.
const FUZZY_MATCH_THRESHOLD = 0.5

// Mirrors frontend/src/utils/imageCompression.ts's normalizeImageMatchKey
// intent (this project keeps that helper duplicated per-module rather
// than sharing an import across the Workers/browser boundary -- see
// importEngine.ts's own copy and its comment on why). Strips a leading
// path, drops the extension, lowercases, collapses whitespace.
//
// Underscore <-> space equivalence (fixed -- was previously only true by
// accident, via the fuzzy-match fallback's bigram similarity, not
// guaranteed): the image-matching-rules panel in BulkImportModal.tsx has
// always told the person "Spaces and underscores are treated as
// equivalent" and the *output* side (buildImageDisplayName, below) has
// always produced "Product Name_1.jpg" with real spaces in the name and
// underscore reserved only as the trailing-index separator -- but this
// normalization never actually folded underscores into spaces on the
// *input* side, so a multi-word product name uploaded with underscores
// throughout (e.g. "product_name_1.jpg" for "Product Name") only matched
// via the fuzzy fallback's similarity score, not the exact-match pass,
// and could miss the exact match entirely once combined with
// stripTrailingIndex on names differing by more than the trailing index.
// Hyphen <-> space equivalence (Part 242, same class of gap as the
// underscore fix above): sanitizeBaseName (below) now turns disallowed
// filename characters -- '/', '\', ':', etc. -- into '-' instead of a
// plain space, so a product name containing one of those (e.g. a size
// like "10/20ml" or a category separator) comes back from export/rename
// as "10-20ml". Re-importing that same file needs the matching key to
// treat that hyphen as equivalent to whatever the original character
// was, exactly the way it already treats underscore as equivalent to
// space. The frontend's own copy of this function
// (BulkImportModal.tsx's normalizeImageMatchKey) already folded both
// `_` and `-` into a space -- this backend copy only folded `_`, so a
// hyphenated re-import silently fell through to the fuzzy-match
// fallback (or missed entirely) instead of the guaranteed exact-match
// pass, the same class of drift the underscore fix closed. Folding `-`
// here too brings this copy back in line with the frontend's.
//
// Real bug found while wiring the above (Part 242): this function
// always treated a leading ".../" as a directory path to strip (via
// split('/').pop()) -- correct for a genuine file path like
// "photos/Coca Cola.jpg", but wrong for a *candidate product name*
// containing a literal '/' as real content (e.g. "10/20ml", "Men/Women
// Fragrance"), which matchImagesToProducts (below) also runs through
// this same function. "10/20ml Perfume" was silently truncated to
// "20ml Perfume" -- the "10/" was discarded as if it were a folder.
// Fixed by only doing the path-strip when the value actually looks like
// a file path (ends in a real extension, e.g. ".jpg"/".png") -- a
// candidate/product name essentially never does. Any '/' or '\' that
// survives past that point (a real one, inside a product name, or a
// leftover in a relative path after its own leading folder was
// stripped) is now folded into a space alongside '_'/'-', so
// "Men/Women Fragrance" and a re-imported "Men-Women-Fragrance_1.jpg"
// (the sanitized-on-export form of that exact name) normalize to the
// identical key.
export function normalizeImageMatchKey(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const looksLikeFilePath = /\.[a-zA-Z0-9]{1,6}$/.test(text)
  const base = looksLikeFilePath ? (text.replace(/\\/g, '/').split('/').pop() || text) : text
  return base.replace(/\.[^./\\]+$/, '').replace(/[_\-/\\]+/g, ' ').trim().replace(/\s+/g, ' ').toLowerCase()
}

// Strips a trailing "_1"/"-2"/" (3)"/" copy 4" index some exporters (or a
// prior run of this very auto-rename) already added, so "coca cola_2" and
// "coca cola" both key to "coca cola" for matching purposes. Only used
// for the *matching* key, never for the rename output itself.
function stripTrailingIndex(key: string): string {
  return key
    .replace(/[\s_-]+\(?\d+\)?$/, '')
    .replace(/\s+copy(\s+\d+)?$/, '')
    .trim()
}

function bigrams(value: string): Map<string, number> {
  const counts = new Map<string, number>()
  // BUGFIX: this was previously `value.length < 2 ? value : value` -- a
  // no-op ternary (both branches returned the identical `value`, so short
  // strings silently fell through with zero bigrams and always scored 0
  // against everything except an exact match). Pad sub-2-char strings with
  // a boundary space on each side so a single-character key still produces
  // at least one real bigram to compare, instead of only ever matching via
  // the `a === b` exact-equality shortcut above.
  const padded = value.length < 2 ? ` ${value} ` : value
  for (let i = 0; i < padded.length - 1; i += 1) {
    const gram = padded.slice(i, i + 2)
    counts.set(gram, (counts.get(gram) || 0) + 1)
  }
  return counts
}

// Sorensen-Dice coefficient over character bigrams -- cheap, dependency-
// free (this runs in a Workers isolate, no npm string-similarity package
// available), and forgiving of word order/minor typos in a way exact
// substring matching isn't (e.g. "Coca Cola 500ml" vs "coca-cola" still
// scores well). Falls back to a containment check for very short strings
// where bigram overlap alone is too coarse (e.g. "coke" vs "coca cola").
// `bBigrams`/`bTotal` are optional pre-computed bigrams for `b` -- the
// fuzzy-match loop below compares the same handful of candidate keys
// against every image, so accepting these lets a candidate's bigrams get
// computed once (O(m)) instead of once per image (O(n*m)); omit them for
// any other one-off caller and this recomputes exactly as before.
function similarity(a: string, b: string, bBigrams?: Map<string, number>, bTotal?: number): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))) {
    return 0.85 * (Math.min(a.length, b.length) / Math.max(a.length, b.length)) + 0.15
  }
  const gramsA = bigrams(a)
  const gramsB = bBigrams ?? bigrams(b)
  let overlap = 0
  for (const [gram, count] of gramsA) {
    const other = gramsB.get(gram)
    if (other) overlap += Math.min(count, other)
  }
  const totalA = [...gramsA.values()].reduce((sum, n) => sum + n, 0)
  const totalB = bTotal ?? [...gramsB.values()].reduce((sum, n) => sum + n, 0)
  if (!totalA || !totalB) return 0
  return (2 * overlap) / (totalA + totalB)
}

// Core best-fit engine. Two passes per image:
// 1. Exact key match (normalized basename === normalized candidate name,
//    with the trailing-index-stripped variant as a second attempt) --
//    every candidate sharing that exact name gets matched (deliberate:
//    the same product name can legitimately appear on several rows, e.g.
//    one per branch, and one uploaded image should attach to all of
//    them, same as `resolveRowImagePath`'s exact-key path already does
//    for the CSV `image_filename_1`-column case).
// 2. Fuzzy fallback against every candidate's normalized name, picking
//    the single highest-scoring candidate at or above the threshold.
// Matches are NOT filtered down to MAX_IMAGES_PER_PRODUCT here -- that's
// `overLimit`'s job, computed as a second pass over the grouped results,
// so the caller (importEngine.ts) can show the operator every image
// that matched, not just the ones that would auto-win.
export function matchImagesToProducts(
  images: UploadedImageRef[],
  candidates: MatchCandidateProduct[],
): ImageMatchSummary {
  const candidateKeys = candidates
    .map((c) => ({ ...c, key: normalizeImageMatchKey(c.name) }))
    .filter((c) => c.key)

  // Pre-computed once per candidate, not once per image*candidate pair --
  // see similarity()'s bBigrams param. candidateKeys is typically the full
  // product list for the import (can be thousands of rows), and this loop
  // runs once per uploaded image, so this turns an O(images * candidates)
  // repeat-recompute into a one-time O(candidates) pass up front.
  const candidateBigrams = candidateKeys.map((c) => {
    const grams = bigrams(c.key)
    const total = [...grams.values()].reduce((sum, n) => sum + n, 0)
    return { grams, total }
  })

  const exactByKey = new Map<string, typeof candidateKeys>()
  for (const candidate of candidateKeys) {
    const list = exactByKey.get(candidate.key) || []
    list.push(candidate)
    exactByKey.set(candidate.key, list)
  }

  const matched: MatchEntry[] = []
  const unmatched: UploadedImageRef[] = []

  for (const image of images) {
    const nameKey = normalizeImageMatchKey(image.originalName)
    const relKey = normalizeImageMatchKey(image.relativePath)
    const strippedNameKey = stripTrailingIndex(nameKey)
    const strippedRelKey = stripTrailingIndex(relKey)

    const exactMatches =
      exactByKey.get(nameKey) ||
      exactByKey.get(relKey) ||
      exactByKey.get(strippedNameKey) ||
      exactByKey.get(strippedRelKey) ||
      []

    if (exactMatches.length) {
      for (const candidate of exactMatches) {
        matched.push({ image, productId: candidate.id, productName: candidate.name, score: 1, matchType: 'exact' })
      }
      continue
    }

    const key = strippedNameKey || nameKey || strippedRelKey || relKey
    if (!key || !candidateKeys.length) {
      unmatched.push(image)
      continue
    }

    let best: { candidate: (typeof candidateKeys)[number]; score: number } | null = null
    for (let i = 0; i < candidateKeys.length; i += 1) {
      const candidate = candidateKeys[i]
      const { grams, total } = candidateBigrams[i]
      const score = similarity(key, candidate.key, grams, total)
      if (!best || score > best.score) best = { candidate, score }
    }

    if (best && best.score >= FUZZY_MATCH_THRESHOLD) {
      matched.push({
        image,
        productId: best.candidate.id,
        productName: best.candidate.name,
        score: best.score,
        matchType: 'fuzzy',
      })
    } else {
      unmatched.push(image)
    }
  }

  const byProduct = new Map<string | number, MatchEntry[]>()
  for (const entry of matched) {
    const list = byProduct.get(entry.productId) || []
    list.push(entry)
    byProduct.set(entry.productId, list)
  }

  const overLimit: ImageMatchSummary['overLimit'] = []
  for (const [productId, entries] of byProduct) {
    if (entries.length <= MAX_IMAGES_PER_PRODUCT) continue
    const all = [...entries].sort((a, b) => b.score - a.score)
    overLimit.push({
      productId,
      productName: all[0].productName,
      limit: MAX_IMAGES_PER_PRODUCT,
      all,
      winners: all.slice(0, MAX_IMAGES_PER_PRODUCT),
    })
  }

  return { matched, unmatched, overLimit }
}

// Sanitizes a product name into a safe file base name -- mirrors
// frontend/src/utils/imageCompression.ts's buildCompressedFileName rules
// exactly (no path separators/control chars, collapsed whitespace,
// length-capped) so a bulk-imported rename and a manual single-image
// rename produce the same kind of filename.
//
// Disallowed characters ('/', '\', ':', '"', '<', '>', '|', '?', '*',
// control chars) become '-' now, not a plain space (Part 242 -- the user
// asked these render as a hyphen so it's visually obvious in the
// filename that a character had to be substituted, rather than silently
// vanishing into whitespace). A run of one or more disallowed characters
// collapses to a single '-'; any '-'/space combination left touching
// each other after that collapses to one '-' too, so "Weird / Name"
// comes out "Weird-Name", not "Weird - Name" or "Weird--Name". Leading/
// trailing '-' or space is trimmed the same way leading/trailing
// whitespace always was.
export function sanitizeBaseName(name: string): string {
  const safe = String(name || 'image')
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[\s-]*-[\s-]*/g, '-')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .slice(0, 150)
  return safe || 'image'
}

function getExtension(originalName: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(originalName || '')
  return (match?.[1] || 'jpg').toLowerCase()
}

// Shared with routes/importJobs.ts's /:id/images/assign-existing --
// building a "ProductName" / "ProductName_2" display name is the exact
// same rule whether the image is being renamed because it best-fit
// matched a CSV row (buildAutoRenamePlan, below) or because an operator
// manually attached it to an existing catalog product one at a time.
// `positionAmongSiblings` is 1-based; pass 1 with `totalSiblings` 1 for
// "no suffix needed" (a product's only image).
export function buildImageDisplayName(
  productName: string,
  originalName: string,
  positionAmongSiblings: number,
  totalSiblings: number,
): string {
  const base = sanitizeBaseName(productName)
  const ext = getExtension(originalName)
  const suffix = totalSiblings > 1 ? `_${positionAmongSiblings}` : ''
  return `${base}${suffix}.${ext}`
}

// Builds { image.id -> new display name } for every matched image,
// named after the product it matched: a single image per product gets
// just the product name; more than one gets "_1", "_2", "_3"... in
// score-descending order (best match first). This is the "of course
// they also have to rename with product name then _1 or _2, 3 etc" rule
// -- applies uniformly whether the match came from an explicit CSV
// `image_filename_*` column, a plain image-only import (no CSV image
// column at all, matched purely against the row's product name), or a
// lazy CSV where the uploaded filenames never matched anything until
// this fuzzy pass found the best fit. Caller is expected to pass only
// the *final* winning matches (post over-limit resolution) -- see
// importEngine.ts's `finalMatched` -- so a product that hit the 5-image
// cap only gets its 5 kept images numbered, not the ones that lost.
export function buildAutoRenamePlan(matched: MatchEntry[]): Map<string | number, string> {
  const byProduct = new Map<string | number, MatchEntry[]>()
  for (const entry of matched) {
    const list = byProduct.get(entry.productId) || []
    list.push(entry)
    byProduct.set(entry.productId, list)
  }

  const plan = new Map<string | number, string>()
  for (const entries of byProduct.values()) {
    const ordered = [...entries].sort((a, b) => b.score - a.score)
    ordered.forEach((entry, index) => {
      plan.set(entry.image.id, buildImageDisplayName(ordered[0].productName, entry.image.originalName, index + 1, ordered.length))
    })
  }
  return plan
}
