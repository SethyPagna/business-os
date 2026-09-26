// In-memory R2 bucket for the ops R2 tests (test-ops-r2-copy-pure.cjs,
// test-ops-r2-driver-pure.cjs), plus the Node stand-ins for the two Worker
// runtime pieces the copy Worker takes through `deps`.
//
// The fake honours what the copy logic depends on:
//   - get() with onlyIf.etagMatches returns the object WITHOUT a body when the
//     precondition fails (R2's behaviour), not null;
//   - put() with md5 rejects bytes that do not hash to it;
//   - put() with onlyIf.etagMatches stores nothing and returns null when the
//     current object is absent or has another etag;
//   - a multipart object's etag is "<hex>-<parts>" and carries no MD5;
//   - list() never returns checksums, drops metadata that was not included,
//     and may return SHORT pages when metadata is included (includePageCap);
//   - every write moves a shared clock forward, so `uploaded` is ordered.
// Faults (bucket.faults): beforeGet(key, bucket), beforePut(key, bucket)
// (may throw), corruptInTransit, dropHttpField, lowercaseCustomKeys.
'use strict'

const crypto = require('crypto')

const md5hex = (buf) => crypto.createHash('md5').update(buf).digest('hex')
const hexToAb = (hex) => Uint8Array.from(Buffer.from(hex, 'hex')).buffer
const abToHex = (ab) => Buffer.from(ab instanceof ArrayBuffer ? new Uint8Array(ab) : ab).toString('hex')

function cloneHttp(h) {
  if (!h) return {}
  const out = {}
  for (const [k, v] of Object.entries(h)) out[k] = v instanceof Date ? new Date(v.getTime()) : v
  return out
}

function streamOf(data) {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= data.length) return controller.close()
      const end = Math.min(offset + 7000, data.length)
      controller.enqueue(new Uint8Array(data.subarray(offset, end)))
      offset = end
    },
  })
}

async function readAll(value) {
  if (value === null || value === undefined) return Buffer.alloc(0)
  if (typeof value === 'string') return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value))
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  const chunks = []
  for await (const chunk of value) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

class FakeR2 {
  constructor(name, clock) {
    this.name = name
    this.clock = clock
    this.objects = new Map()
    this.calls = []
    this.faults = {}
    this.includePageCap = 0
  }
  now() {
    this.clock.t += 1000
    return new Date(this.clock.t)
  }
  seed(key, content, { httpMetadata, customMetadata, storageClass, multipartParts, uploaded } = {}) {
    const data = Buffer.from(content)
    const md5 = md5hex(data)
    const multipart = Boolean(multipartParts)
    this.objects.set(key, {
      key,
      data,
      etag: multipart ? `${md5hex(Buffer.from(`parts:${md5}`))}-${multipartParts}` : md5,
      checksums: multipart ? {} : { md5: hexToAb(md5) },
      uploaded: uploaded ? new Date(uploaded) : this.now(),
      httpMetadata: cloneHttp(httpMetadata),
      customMetadata: { ...(customMetadata || {}) },
      storageClass: storageClass || 'Standard',
      version: crypto.randomUUID(),
    })
  }
  view(o, body) {
    const r = {
      key: o.key,
      size: o.data.length,
      etag: o.etag,
      httpEtag: `"${o.etag}"`,
      uploaded: new Date(o.uploaded.getTime()),
      version: o.version,
      storageClass: o.storageClass,
      httpMetadata: cloneHttp(o.httpMetadata),
      customMetadata: { ...o.customMetadata },
      checksums: { ...o.checksums },
    }
    if (body) r.body = streamOf(o.data)
    return r
  }
  async head(key) {
    this.calls.push('head')
    const o = this.objects.get(key)
    return o ? this.view(o, false) : null
  }
  async get(key, options = {}) {
    this.calls.push('get')
    if (this.faults.beforeGet) this.faults.beforeGet(key, this)
    const o = this.objects.get(key)
    if (!o) return null
    const want = options.onlyIf && options.onlyIf.etagMatches
    if (want && want !== o.etag) return this.view(o, false) // precondition failed: no body
    return this.view(o, true)
  }
  async put(key, value, options = {}) {
    this.calls.push('put')
    if (this.faults.beforePut) this.faults.beforePut(key, this)
    // R2: a put whose onlyIf precondition fails stores nothing and returns null.
    const want = options.onlyIf && options.onlyIf.etagMatches
    if (want !== undefined && want !== null) {
      const current = this.objects.get(key)
      if (!current || current.etag !== want) return null
    }
    let data = await readAll(value)
    if (this.faults.corruptInTransit) {
      data = Buffer.from(data)
      if (data.length) data[0] ^= 0xff
    }
    if (options.md5 !== undefined) {
      const want = typeof options.md5 === 'string' ? options.md5 : abToHex(options.md5)
      if (md5hex(data) !== want) throw new Error('put: The Content-MD5 you specified did not match what was received.')
    }
    const md5 = md5hex(data)
    this.objects.set(key, {
      key,
      data,
      etag: md5,
      checksums: { md5: hexToAb(md5) },
      uploaded: this.now(),
      httpMetadata: this.faults.dropHttpField ? (() => { const h = cloneHttp(options.httpMetadata); delete h[this.faults.dropHttpField]; return h })() : cloneHttp(options.httpMetadata),
      customMetadata: this.faults.lowercaseCustomKeys
        ? Object.fromEntries(Object.entries(options.customMetadata || {}).map(([k, v]) => [k.toLowerCase(), v]))
        : { ...(options.customMetadata || {}) },
      storageClass: options.storageClass || 'Standard',
      version: crypto.randomUUID(),
    })
    return this.view(this.objects.get(key), false)
  }
  async delete(keys) {
    this.calls.push('delete')
    for (const k of [].concat(keys)) this.objects.delete(k)
  }
  async list({ cursor, limit = 1000, include } = {}) {
    this.calls.push('list')
    const keys = [...this.objects.keys()].sort()
    const start = cursor ? Number(cursor) : 0
    const size = include && this.includePageCap ? Math.min(limit, this.includePageCap) : limit
    const slice = keys.slice(start, start + size)
    const truncated = start + size < keys.length
    return {
      objects: slice.map((k) => {
        const v = this.view(this.objects.get(k), false)
        delete v.checksums // do not rely on list returning checksums
        if (!include || !include.includes('httpMetadata')) delete v.httpMetadata
        if (!include || !include.includes('customMetadata')) delete v.customMetadata
        return v
      }),
      truncated,
      cursor: truncated ? String(start + size) : undefined,
      delimitedPrefixes: [],
    }
  }
  writes() {
    return this.calls.filter((c) => c === 'put' || c === 'delete').length
  }
  // Content + metadata snapshot, for "nothing changed" assertions.
  snapshot() {
    return JSON.stringify([...this.objects.values()].map((o) => [o.key, md5hex(o.data), o.etag, o.uploaded.toISOString(), o.storageClass, o.httpMetadata, o.customMetadata]))
  }
}

const nodeDeps = {
  md5OfStream: async (stream) => {
    const h = crypto.createHash('md5')
    for await (const chunk of stream) h.update(chunk)
    return h.digest('hex')
  },
  // Emulates FixedLengthStream: errors unless exactly `size` bytes pass.
  fixedLength: (stream, size) => {
    let n = 0
    return stream.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        n += chunk.byteLength
        if (n > size) controller.error(new Error('stream longer than declared'))
        else controller.enqueue(chunk)
      },
      flush(controller) {
        if (n !== size) controller.error(new Error('stream shorter than declared'))
      },
    }))
  },
  capabilities: () => ({ digestStreamMd5: true, fixedLengthStream: true }),
}

const FIXTURE_HTTP = Object.freeze({
  contentType: 'image/webp',
  contentLanguage: 'km',
  contentDisposition: 'inline; filename="x.webp"',
  contentEncoding: 'identity',
  cacheControl: 'public, max-age=31536000, immutable',
  cacheExpiry: new Date('2027-01-02T03:04:05.678Z'),
})
const FIXTURE_CUSTOM = Object.freeze({ lifecycle: 'managed', OriginalName: 'ផលិតផល.webp', 'x-Mixed_Case': 'Value With Spaces' })

function setup(start = '2026-09-01T00:00:00Z') {
  const clock = { t: Date.parse(start) }
  return { clock, source: new FakeR2('source', clock), destination: new FakeR2('destination', clock) }
}

module.exports = { FakeR2, nodeDeps, md5hex, setup, FIXTURE_HTTP, FIXTURE_CUSTOM }
