// The weekly set's home in R2: S3-compatible PUT / HEAD / LIST / DELETE signed with node:crypto (no package), a prefix guard that refuses every key
// outside backups/weekly/, the upload-then-verify step, pruning to the newest WEEKLY_KEEP sets and the marker written last. The client takes an
// injected fetch, so every test runs against a local fake and nothing here reaches the network on its own.

import crypto from 'node:crypto'
import { OpsError } from '../ops-common.mjs'
import { WEEKLY_KEEP, WEEKLY_MARKER_KEY, WEEKLY_PREFIX } from './constants.mjs'

const KEY_CHARS = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/
const SET_ID = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9]{1,24}$/
export const MANIFEST_NAME = 'manifest.enc.json'
export const MARKER_FIELDS = Object.freeze([
  'format', 'runId', 'commit', 'startedAt', 'finishedAt', 'backupOk', 'healthOk', 'anchorOk',
  'files', 'encryptedBytes', 'manifestSha256', 'timeTravelStartBookmark', 'engines',
])

// The one gate every call passes: a key is inside the weekly prefix, plain, and never climbs out of it.
export function assertWeeklyKey(key) {
  const text = typeof key === 'string' ? key : ''
  if (!text.startsWith(WEEKLY_PREFIX) || text.length > 512 || !KEY_CHARS.test(text) || text.includes('..') || text.includes('//') || text.endsWith('/')) {
    throw new OpsError('weekly-key-refused', 'An R2 key outside backups/weekly/ was refused.')
  }
  return text
}
export function assertWeeklyPrefix(prefix) {
  if (typeof prefix !== 'string' || !prefix.startsWith(WEEKLY_PREFIX) || prefix.includes('..') || prefix.includes('//') || !KEY_CHARS.test(prefix)) {
    throw new OpsError('weekly-key-refused', 'An R2 prefix outside backups/weekly/ was refused.')
  }
  return prefix
}

// ------------------------------------------------------------------ SigV4

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex')
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
const encodeRfc3986 = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export function sigV4Authorization({ method, canonicalUri, query = {}, headers, payloadHash, amzDate, region, service, accessKeyId, secretAccessKey }) {
  const names = Object.keys(headers).map((n) => n.toLowerCase()).sort()
  const lower = Object.fromEntries(Object.entries(headers).map(([n, v]) => [n.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]))
  const canonicalQuery = Object.keys(query).sort().map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(String(query[k]))}`).join('&')
  const canonicalRequest = [method, canonicalUri, canonicalQuery, ...names.map((n) => `${n}:${lower[n]}`), '', names.join(';'), payloadHash].join('\n')
  const day = amzDate.slice(0, 8)
  const scope = `${day}/${region}/${service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(toSign).digest('hex')
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`
}

// Cloudflare derives an R2 S3 secret from an API token: access key id = the token id, secret = sha256 of the token value.
export function secretFromToken(tokenValue) {
  return sha256Hex(String(tokenValue))
}

function decodeXml(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}
export function parseListXml(xml) {
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
    key: decodeXml((m[1].match(/<Key>([\s\S]*?)<\/Key>/) || [])[1] || ''),
    size: Number((m[1].match(/<Size>(\d+)<\/Size>/) || [])[1] || 0),
  }))
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml)
  const next = (xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/) || [])[1]
  return { objects, next: truncated && next ? decodeXml(next) : null }
}

export function s3Client({ accountId, bucket, accessKeyId, secretAccessKey, fetchFn = globalThis.fetch, now = () => new Date() }) {
  const host = `${accountId}.r2.cloudflarestorage.com`
  const call = async (method, key, { query = {}, body = null } = {}) => {
    const amzDate = now().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    const payload = body === null ? Buffer.alloc(0) : Buffer.from(body)
    const payloadHash = sha256Hex(payload)
    const canonicalUri = `/${bucket}${key ? `/${key.split('/').map(encodeRfc3986).join('/')}` : ''}`
    const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate }
    const authorization = sigV4Authorization({ method, canonicalUri, query, headers, payloadHash, amzDate, region: 'auto', service: 's3', accessKeyId, secretAccessKey })
    const qs = Object.keys(query).sort().map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(String(query[k]))}`).join('&')
    return fetchFn(`https://${host}${canonicalUri}${qs ? `?${qs}` : ''}`, {
      method, headers: { ...headers, authorization }, ...(method === 'PUT' ? { body: payload } : {}),
    })
  }
  return {
    async put(key, body) {
      const response = await call('PUT', key, { body })
      if (!response.ok) throw new OpsError('r2-put-failed', 'An R2 PUT failed.')
    },
    async head(key) {
      const response = await call('HEAD', key)
      if (response.status === 404) return null
      if (!response.ok) throw new OpsError('r2-head-failed', 'An R2 HEAD failed.')
      return { size: Number(response.headers.get('content-length')), etag: String(response.headers.get('etag') || '').replace(/"/g, '') }
    },
    async list(prefix) {
      const objects = []
      let token = null
      do {
        const response = await call('GET', '', { query: { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) } })
        if (!response.ok) throw new OpsError('r2-list-failed', 'An R2 LIST failed.')
        const page = parseListXml(await response.text())
        objects.push(...page.objects)
        token = page.next
      } while (token)
      return objects
    },
    async delete(key) {
      const response = await call('DELETE', key)
      if (!response.ok && response.status !== 404) throw new OpsError('r2-delete-failed', 'An R2 DELETE failed.')
    },
  }
}

// ---------------------------------------------------------------- the store

// Wraps any client so that no call can name a key outside backups/weekly/, whatever the caller computed.
export function weeklyStore(client) {
  return {
    put: async (key, body) => client.put(assertWeeklyKey(key), body),
    head: async (key) => client.head(assertWeeklyKey(key)),
    list: async (prefix = WEEKLY_PREFIX) => client.list(assertWeeklyPrefix(prefix)),
    delete: async (key) => client.delete(assertWeeklyKey(key)),
  }
}

export function setIdFor(date, run) {
  const id = `${String(date).slice(0, 10)}-${String(run).replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`
  if (!SET_ID.test(id)) throw new OpsError('weekly-set-id-invalid', 'The weekly set id is malformed.')
  return id
}

// The marker holds only the allowlisted fields: never a table name, a count of rows or a business figure.
export function buildMarker(fields) {
  const marker = {}
  for (const name of MARKER_FIELDS) if (Object.prototype.hasOwnProperty.call(fields, name)) marker[name] = fields[name]
  return marker
}

// PUT every file, then HEAD each one: the size must equal what was sent (and, for a single PUT, the MD5 etag). Any miss fails the set.
export async function uploadSet({ store, setId, files }) {
  if (!SET_ID.test(setId)) throw new OpsError('weekly-set-id-invalid', 'The weekly set id is malformed.')
  let bytes = 0
  for (const file of files) {
    const key = `${WEEKLY_PREFIX}${setId}/${file.name}`
    await store.put(key, file.bytes)
    const head = await store.head(key)
    const md5 = crypto.createHash('md5').update(file.bytes).digest('hex')
    if (!head || head.size !== file.bytes.length || (head.etag && !head.etag.includes('-') && head.etag !== md5)) {
      return { ok: false, bytes, problem: 'verify-failed' }
    }
    bytes += file.bytes.length
  }
  return { ok: true, bytes, files: files.length }
}

// Sets are the folders under backups/weekly/; a set counts only when its manifest is there. Newest first by id (date, then run).
export function groupSets(objects) {
  const sets = new Map()
  for (const object of objects) {
    const rest = object.key.slice(WEEKLY_PREFIX.length)
    const slash = rest.indexOf('/')
    if (slash < 0) continue
    const id = rest.slice(0, slash)
    if (!SET_ID.test(id)) continue
    if (!sets.has(id)) sets.set(id, { id, keys: [], complete: false })
    const set = sets.get(id)
    set.keys.push(object.key)
    if (rest.slice(slash + 1) === MANIFEST_NAME) set.complete = true
  }
  return [...sets.values()].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}

// Keeps the newest `keep` complete sets (never fewer than one, never the newest verified set) and deletes the older ones under the prefix. A folder
// newer than the verified set is left alone. Runs only after the new set verified.
export async function pruneSets({ store, newestVerifiedId, keep = WEEKLY_KEEP, verified = true }) {
  if (!verified) return { deleted: 0, kept: [], skipped: 'new-set-not-verified' }
  if (!Number.isInteger(keep) || keep < 1) throw new OpsError('weekly-keep-invalid', 'WEEKLY_KEEP must be at least 1.')
  const sets = groupSets(await store.list(WEEKLY_PREFIX))
  const newest = sets.find((s) => s.id === newestVerifiedId)
  if (!newest || !newest.complete) return { deleted: 0, kept: sets.map((s) => s.id), skipped: 'newest-not-found' }
  const keepIds = new Set(sets.filter((s) => s.complete).slice(0, keep).map((s) => s.id))
  keepIds.add(newestVerifiedId)
  let deleted = 0
  for (const set of sets) {
    if (keepIds.has(set.id) || set.id > newestVerifiedId) continue
    for (const key of set.keys) { await store.delete(key); deleted += 1 }
  }
  return { deleted, kept: [...keepIds].sort().reverse() }
}

// The whole store step, in the one order that keeps the bell honest: upload, verify, prune, and the marker LAST. A crash anywhere before the
// last PUT leaves the old marker, so the bell keeps counting from the last good set.
export async function storeWeekly({ store, setId, files, marker }) {
  const uploaded = await uploadSet({ store, setId, files })
  if (!uploaded.ok) return { ok: false, uploaded, pruned: null, marker: false }
  const pruned = await pruneSets({ store, newestVerifiedId: setId })
  await store.put(WEEKLY_MARKER_KEY, Buffer.from(`${JSON.stringify(buildMarker(marker))}\n`))
  return { ok: true, uploaded, pruned, marker: true }
}
