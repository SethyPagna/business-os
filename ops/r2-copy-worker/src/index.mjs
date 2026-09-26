// HTTP surface of the temporary R2 copy Worker. See ../wrangler.toml.
//
//   GET  /health                                   -> capabilities
//   POST /list   { bucket, cursor, limit }         -> one listing page
//   POST /copy   { items: [{ key, expectEtag, force }], allowOverwrite }
//   POST /verify { keys }                          (read-only)
//   POST /prune  { keys, confirm: 'destination-only' }
//
// Every route needs `Authorization: Bearer <COPY_TOKEN>`; with no secret set
// the Worker refuses everything. It writes nothing to the console, so no key
// or metadata reaches Workers logs.

import { copyOne, listPage, pruneOne, readOnlyBucket, toHex, verifyOne } from './core.mjs'

export const MIN_TOKEN_CHARS = 32
export const MAX_BODY_BYTES = 1024 * 1024
export const MAX_COPY_ITEMS = 25
export const MAX_KEYS = 100

class HttpError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
    this.code = code
  }
}

export function runtimeDeps() {
  return {
    md5OfStream: async (stream) => {
      const digest = new crypto.DigestStream('MD5')
      await stream.pipeTo(digest)
      return toHex(await digest.digest)
    },
    // A stream of known length, as R2 put requires; errors if the byte count
    // differs from `size`.
    fixedLength: (stream, size) => {
      const { readable, writable } = new FixedLengthStream(size)
      stream.pipeTo(writable).catch(() => { /* surfaces as a failed put */ })
      return readable
    },
    capabilities: () => {
      let digestStreamMd5 = false
      try {
        new crypto.DigestStream('MD5') // eslint-disable-line no-new
        digestStreamMd5 = true
      } catch { /* unsupported */ }
      return { digestStreamMd5, fixedLengthStream: typeof FixedLengthStream === 'function' }
    },
  }
}

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

// Constant-time on the digests, so neither the length nor the content of the
// secret leaks through timing.
export async function authorized(request, token) {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') || '')
  const presented = match ? match[1] : ''
  const [a, b] = await Promise.all([sha256(presented), sha256(token)])
  let diff = presented ? 0 : 1
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i]
  return diff === 0
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

async function readJson(request) {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'body-too-large')
  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object')
    return body
  } catch {
    throw new HttpError(400, 'bad-json')
  }
}

function validKey(key) {
  return typeof key === 'string' && key.length > 0 && new TextEncoder().encode(key).length <= 1024
}

function keyList(body) {
  const keys = Array.isArray(body.keys) ? body.keys : null
  if (!keys || !keys.length || keys.length > MAX_KEYS || !keys.every(validKey)) throw new HttpError(400, 'bad-keys')
  return keys
}

export async function handle(request, env, deps) {
  const token = typeof env.COPY_TOKEN === 'string' ? env.COPY_TOKEN : ''
  if (token.length < MIN_TOKEN_CHARS) return json(503, { error: 'not-configured' })
  if (!env.SOURCE || !env.DESTINATION) return json(503, { error: 'bindings-missing' })
  if (!(await authorized(request, token))) return json(401, { error: 'unauthorized' })

  const source = readOnlyBucket(env.SOURCE)
  const destination = env.DESTINATION
  const route = `${request.method} ${new URL(request.url).pathname}`
  try {
    switch (route) {
      case 'GET /health':
        return json(200, { ok: true, capabilities: deps.capabilities() })
      case 'POST /list': {
        const body = await readJson(request)
        const bucket = body.bucket === 'source' ? source : body.bucket === 'destination' ? readOnlyBucket(destination) : null
        if (!bucket) throw new HttpError(400, 'bad-bucket')
        if (body.cursor !== undefined && body.cursor !== null && typeof body.cursor !== 'string') throw new HttpError(400, 'bad-cursor')
        return json(200, await listPage(bucket, body.cursor, body.limit))
      }
      case 'POST /copy': {
        const body = await readJson(request)
        const items = Array.isArray(body.items) ? body.items : null
        if (!items || !items.length || items.length > MAX_COPY_ITEMS || !items.every((i) => i && validKey(i.key))) {
          throw new HttpError(400, 'bad-items')
        }
        const results = []
        for (const item of items) {
          results.push(await copyOne({
            source,
            destination,
            key: item.key,
            expectEtag: typeof item.expectEtag === 'string' ? item.expectEtag : undefined,
            allowOverwrite: body.allowOverwrite === true,
            force: item.force === true,
            deps,
          }))
        }
        return json(200, { results })
      }
      case 'POST /verify': {
        const keys = keyList(await readJson(request))
        const results = []
        for (const key of keys) results.push(await verifyOne({ source, destination: readOnlyBucket(destination), key, deps }))
        return json(200, { results })
      }
      case 'POST /prune': {
        const body = await readJson(request)
        if (body.confirm !== 'destination-only') throw new HttpError(400, 'prune-not-confirmed')
        const keys = keyList(body)
        const results = []
        for (const key of keys) results.push(await pruneOne({ source, destination, key }))
        return json(200, { results })
      }
      default:
        return json(404, { error: 'not-found' })
    }
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code })
    return json(500, { error: 'internal', message: String((err && err.message) || err).slice(0, 300) })
  }
}

export default {
  fetch(request, env) {
    return handle(request, env, runtimeDeps())
  },
}
