// Per-object logic of the temporary R2 copy Worker (business-os-r2-copy).
//
// Runtime-only pieces (crypto.DigestStream, FixedLengthStream) arrive through
// `deps`, so test-ops-r2-copy-pure.cjs drives this exact code against an
// in-memory R2 fake.
//
// Invariants:
//   - SOURCE is only reached through readOnlyBucket(): head, get, list.
//   - A copy is: head source -> MD5 (from the etag / checksum, or by
//     streaming the object when its etag is a multipart etag) -> get with
//     onlyIf etagMatches -> put to DESTINATION with the object's own
//     httpMetadata, customMetadata and storageClass, plus md5 so R2 itself
//     rejects a body that does not hash to it -> head DESTINATION -> compare
//     size, MD5, storage class and every metadata field exactly.
//   - `uploaded` cannot be set by put. The driver orders the copy of the
//     keys whose `uploaded` order the app relies on (backups).
//   - The only delete is pruneOne() on DESTINATION, and only for a key the
//     source does not have at that moment.

export const MD5_HEX = /^[0-9a-f]{32}$/
const MULTIPART_ETAG = /^[0-9a-f]{32}-\d+$/

export function toHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

export function hexToBytes(hex) {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error('not hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function readOnlyBucket(bucket) {
  return Object.freeze({
    head: (key) => bucket.head(key),
    get: (key, options) => bucket.get(key, options),
    list: (options) => bucket.list(options),
  })
}

export function normalizeHttpMetadata(value) {
  const out = {}
  if (!value || typeof value !== 'object') return out
  for (const name of Object.keys(value).sort()) {
    const v = value[name]
    if (v === undefined || v === null) continue
    out[name] = v instanceof Date ? v.toISOString() : String(v)
  }
  return out
}

export function normalizeCustomMetadata(value) {
  const out = {}
  if (!value || typeof value !== 'object') return out
  for (const name of Object.keys(value).sort()) out[name] = String(value[name])
  return out
}

function checksumHex(obj, name) {
  const v = obj && obj.checksums ? obj.checksums[name] : undefined
  if (!v) return undefined
  return typeof v === 'string' ? v.toLowerCase() : toHex(v)
}

// JSON-safe description of an R2Object from head / get / list.
export function describe(obj) {
  if (!obj) return null
  const etag = String(obj.etag || '').toLowerCase()
  const uploaded = obj.uploaded instanceof Date ? obj.uploaded.toISOString() : obj.uploaded ? String(obj.uploaded) : null
  return {
    key: obj.key,
    size: obj.size,
    etag,
    uploaded,
    storageClass: obj.storageClass || 'Standard',
    httpMetadata: normalizeHttpMetadata(obj.httpMetadata),
    customMetadata: normalizeCustomMetadata(obj.customMetadata),
    // A single-part R2 etag IS the MD5 of the bytes; a multipart etag
    // ("<hex>-<parts>") is not, and needs a streamed MD5.
    md5: checksumHex(obj, 'md5') || (MD5_HEX.test(etag) ? etag : undefined),
    multipart: MULTIPART_ETAG.test(etag),
    ssec: Boolean(obj.ssecKeyMd5),
  }
}

// Every way two descriptions can differ. `content-unverified` means an MD5
// was unavailable on one side -- never treated as equal.
export function differences(src, dst) {
  const diffs = []
  if (src.size !== dst.size) diffs.push('size')
  if (!src.md5 || !dst.md5) diffs.push('content-unverified')
  else if (src.md5 !== dst.md5) diffs.push('content')
  if (src.storageClass !== dst.storageClass) diffs.push('storageClass')
  const hs = src.httpMetadata
  const hd = dst.httpMetadata
  for (const name of [...new Set([...Object.keys(hs), ...Object.keys(hd)])].sort()) {
    if (hs[name] !== hd[name]) diffs.push(`httpMetadata.${name}`)
  }
  const cs = src.customMetadata
  const cd = dst.customMetadata
  const ck = Object.keys(cs)
  if (ck.length !== Object.keys(cd).length || ck.some((k) => !Object.prototype.hasOwnProperty.call(cd, k) || cd[k] !== cs[k])) {
    diffs.push('customMetadata')
  }
  return diffs
}

function writtenOutcome(existedBefore, identicalBefore) {
  if (!existedBefore) return 'copied'
  return identicalBefore ? 'rewritten' : 'overwritten'
}

async function streamMd5(bucket, key, etag, deps) {
  const obj = await bucket.get(key, { onlyIf: { etagMatches: etag } })
  if (!obj || !obj.body) return null // gone, or changed since the head
  return deps.md5OfStream(obj.body)
}

async function discard(stream) {
  try { await stream.cancel() } catch { /* already closed */ }
}

function errorText(err) {
  return String((err && err.message) || err).slice(0, 300)
}

// Copies one key SOURCE -> DESTINATION and proves the result.
// outcome: copied | overwritten | rewritten | skipped-identical | conflict |
//          source-missing | mismatch | failed
// force (honoured only with allowOverwrite): re-put an identical object so
// its destination `uploaded` moves after the objects written before it --
// the driver's repair of the backup order, which the app sorts by uploaded.
export async function copyOne({ source, destination, key, deps, allowOverwrite = false, force = false, expectEtag, maxAttempts = 3 }) {
  let problem = 'unknown'
  let lastDiffs
  let lastError
  let existedBefore = null
  let identicalBefore = false
  let wroteHere = false
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const headSrc = await source.head(key)
      if (!headSrc) return { key, outcome: 'source-missing' }
      const src = describe(headSrc)
      if (src.ssec) return { key, outcome: 'failed', reason: 'ssec-encrypted' }
      const sourceChanged = Boolean(expectEtag) && expectEtag !== src.etag
      if (!src.md5) {
        src.md5 = await streamMd5(source, key, src.etag, deps)
        if (!src.md5) { problem = 'source-changed-while-reading'; continue }
      }

      const headDst = await destination.head(key)
      if (existedBefore === null) existedBefore = Boolean(headDst)
      if (headDst) {
        const dst = describe(headDst)
        if (!dst.md5 && !dst.ssec) dst.md5 = await streamMd5(destination, key, dst.etag, deps)
        const diffs = differences(src, dst)
        if (!diffs.length) {
          if (wroteHere) return { key, outcome: writtenOutcome(existedBefore, identicalBefore), size: src.size, sourceChanged }
          if (!(force && allowOverwrite)) return { key, outcome: 'skipped-identical', size: src.size, sourceChanged }
          identicalBefore = true
        } else if (!allowOverwrite && !wroteHere) {
          return { key, outcome: 'conflict', diffs }
        }
      }

      const body = await source.get(key, { onlyIf: { etagMatches: src.etag } })
      if (!body || !body.body) { problem = 'source-changed-while-reading'; continue }
      const got = describe(body)
      if (got.etag !== src.etag || got.size !== src.size) {
        await discard(body.body)
        problem = 'source-changed-while-reading'
        continue
      }
      got.md5 = src.md5 // same etag, same bytes
      let value
      if (got.size === 0) {
        await discard(body.body)
        value = new Uint8Array(0)
      } else {
        value = deps.fixedLength(body.body, got.size)
      }
      const options = {
        httpMetadata: body.httpMetadata || {},
        customMetadata: body.customMetadata || {},
        md5: hexToBytes(src.md5).buffer, // R2 refuses the put unless the bytes hash to this
      }
      if (body.storageClass) options.storageClass = body.storageClass
      wroteHere = true
      await destination.put(key, value, options)

      const after = describe(await destination.head(key))
      if (!after) { problem = 'destination-missing-after-put'; continue }
      if (!after.md5) after.md5 = await streamMd5(destination, key, after.etag, deps)
      const diffs = differences(got, after)
      if (!diffs.length) return { key, outcome: writtenOutcome(existedBefore, identicalBefore), size: got.size, sourceChanged }
      problem = 'mismatch-after-put'
      lastDiffs = diffs
    } catch (err) {
      problem = 'error'
      lastError = errorText(err)
    }
  }
  if (problem === 'mismatch-after-put') return { key, outcome: 'mismatch', diffs: lastDiffs }
  return { key, outcome: 'failed', reason: problem, error: lastError }
}

// Read-only comparison of one key in both buckets.
// outcome: identical | different | missing-in-destination | destination-only | absent | failed
export async function verifyOne({ source, destination, key, deps }) {
  try {
    const [hs, hd] = await Promise.all([source.head(key), destination.head(key)])
    if (!hs && !hd) return { key, outcome: 'absent' }
    if (!hs) return { key, outcome: 'destination-only' }
    if (!hd) return { key, outcome: 'missing-in-destination' }
    const src = describe(hs)
    const dst = describe(hd)
    if (!src.md5 && !src.ssec) src.md5 = await streamMd5(source, key, src.etag, deps)
    if (!dst.md5 && !dst.ssec) dst.md5 = await streamMd5(destination, key, dst.etag, deps)
    const diffs = differences(src, dst)
    return { key, outcome: diffs.length ? 'different' : 'identical', diffs, size: src.size }
  } catch (err) {
    return { key, outcome: 'failed', error: errorText(err) }
  }
}

// Deletes a DESTINATION key that the source does not have (a key deleted from
// the source after it was copied). Re-checks the source first.
// outcome: pruned | kept-source-present | already-absent | failed
export async function pruneOne({ source, destination, key }) {
  try {
    if (await source.head(key)) return { key, outcome: 'kept-source-present' }
    const d = await destination.head(key)
    if (!d) return { key, outcome: 'already-absent' }
    await destination.delete(key)
    return { key, outcome: 'pruned', size: d.size }
  } catch (err) {
    return { key, outcome: 'failed', error: errorText(err) }
  }
}

// One listing page with the metadata needed to compare buckets. R2 may
// return fewer than `limit` objects when metadata is included; callers loop
// on `truncated`, never on the page size.
export async function listPage(bucket, cursor, limit) {
  const n = Math.max(1, Math.min(1000, Number(limit) || 1000))
  const page = await bucket.list({ cursor: cursor || undefined, limit: n, include: ['httpMetadata', 'customMetadata'] })
  return {
    objects: (page.objects || []).map(describe),
    truncated: Boolean(page.truncated),
    cursor: page.truncated ? page.cursor : null,
  }
}
