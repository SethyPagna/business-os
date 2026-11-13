// A realistic in-memory R2 bucket for backup tests: binary-safe bodies (Buffers), md5 etags, list() with prefix,
// delimiter (+ delimitedPrefixes), cursor pagination and `include`, get() with onlyIf.etagMatches, head(),
// multipart upload, batch delete, and counters that sort every call into Cloudflare's operation classes
// (Class A = list/put/copy/multipart/delete-less writes; Class B = get/head). delete is free on R2 and is counted
// separately. The older per-file fakes hold bodies as UTF-8 strings, which would corrupt gzip bytes; new tests use this.
const { createHash, randomUUID } = require('node:crypto')

function toBuffer(data) {
  if (data == null) return Buffer.alloc(0)
  if (Buffer.isBuffer(data)) return Buffer.from(data)
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data))
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  throw new Error('fake R2: unsupported body')
}
async function readAll(stream) {
  const reader = stream.getReader()
  const chunks = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}
function streamOf(buffer) {
  return new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(buffer)); controller.close() } })
}

function makeFakeR2(seed = {}, { pageLimit = 1000 } = {}) {
  const store = new Map()
  const ops = { classA: 0, classB: 0, puts: [], gets: [], lists: 0, deletes: 0 }
  const failGets = new Set()
  const putObject = (key, buffer, opts) => {
    store.set(key, {
      body: buffer, etag: createHash('md5').update(buffer).digest('hex'), version: randomUUID(), size: buffer.length,
      uploaded: new Date(), httpMetadata: opts?.httpMetadata, customMetadata: opts?.customMetadata,
    })
  }
  const meta = (key, o) => ({ key, size: o.size, etag: o.etag, version: o.version, uploaded: o.uploaded, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata })
  for (const [key, value] of Object.entries(seed)) putObject(key, toBuffer(value.body ?? key), value)
  const bucket = {
    _store: store,
    _ops: ops,
    _failGets: failGets,
    _resetOps() { ops.classA = 0; ops.classB = 0; ops.puts = []; ops.gets = []; ops.lists = 0; ops.deletes = 0 },
    _set(key, body, opts) { putObject(key, toBuffer(body), opts) },
    _text(key) { return store.has(key) ? store.get(key).body.toString('utf8') : null },
    async get(key, options) {
      ops.classB += 1; ops.gets.push(key)
      if (failGets.has(key)) return null
      const object = store.get(key)
      if (!object) return null
      if (options?.onlyIf?.etagMatches && options.onlyIf.etagMatches !== object.etag) return meta(key, object)
      return { ...meta(key, object), body: streamOf(object.body), text: async () => object.body.toString('utf8'), json: async () => JSON.parse(object.body.toString('utf8')), arrayBuffer: async () => new Uint8Array(object.body).buffer }
    },
    async head(key) {
      ops.classB += 1
      const object = store.get(key)
      return object ? meta(key, object) : null
    },
    async put(key, data, opts) {
      ops.classA += 1; ops.puts.push(key)
      const buffer = data && typeof data.getReader === 'function' ? await readAll(data) : toBuffer(data)
      putObject(key, buffer, opts)
      return meta(key, store.get(key))
    },
    async delete(keys) {
      ops.deletes += 1
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key)
    },
    async list({ prefix = '', cursor, limit = 1000, delimiter, include } = {}) {
      ops.classA += 1; ops.lists += 1
      const size = Math.min(limit, pageLimit)
      const matching = [...store.keys()].filter((key) => key.startsWith(prefix)).sort()
      const entries = []
      const seenPrefixes = new Set()
      for (const key of matching) {
        if (delimiter) {
          const at = key.indexOf(delimiter, prefix.length)
          if (at >= 0) {
            const group = key.slice(0, at + delimiter.length)
            if (!seenPrefixes.has(group)) { seenPrefixes.add(group); entries.push({ prefix: group }) }
            continue
          }
        }
        entries.push({ key })
      }
      const start = cursor ? Number(cursor) : 0
      const page = entries.slice(start, start + size)
      const truncated = start + size < entries.length
      return {
        objects: page.filter((entry) => entry.key).map((entry) => {
          const object = store.get(entry.key)
          return { ...meta(entry.key, object), customMetadata: include?.includes('customMetadata') ? object.customMetadata : undefined, httpMetadata: include?.includes('httpMetadata') ? object.httpMetadata : undefined }
        }),
        delimitedPrefixes: page.filter((entry) => entry.prefix).map((entry) => entry.prefix),
        truncated,
        cursor: truncated ? String(start + size) : undefined,
      }
    },
    async createMultipartUpload(key, opts) {
      ops.classA += 1
      const parts = new Map()
      return {
        key, uploadId: `upload-${key}`,
        async uploadPart(partNumber, body) { ops.classA += 1; parts.set(partNumber, toBuffer(body)); return { partNumber, etag: `part-${partNumber}` } },
        async complete(uploaded) {
          ops.classA += 1; ops.puts.push(key)
          putObject(key, Buffer.concat(uploaded.map((part) => part.partNumber).sort((a, b) => a - b).map((n) => parts.get(n))), opts)
          return meta(key, store.get(key))
        },
        async abort() { parts.clear() },
      }
    },
  }
  return bucket
}

module.exports = { makeFakeR2 }
