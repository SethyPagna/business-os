import type { Env } from '../index'
import { buildUniqueStoredName, getMediaType, sanitizeOriginalFileName } from '../lib/fileAssets'
import { getDb } from '../lib/db'

// Backs the offline "sync file upload" flow, ported from
// backend/src/routes/sync.ts's /files/chunks/* endpoints. The legacy Docker
// backend staged chunks on local disk (STORAGE_ROOT/sync-upload-chunks/<id>)
// across three separate requests (init -> chunk -> complete) -- fine for a
// single long-lived process, but Workers has no local disk and no
// guarantee that repeated requests for the same upload hit the same
// isolate. A Durable Object is the right primitive here: one instance per
// uploadId gives every request for that upload a single, strongly
// consistent place to accumulate binary chunks and a single owner to
// finalize them -- the same shape the local-disk version had, just made to
// work across a distributed edge network instead of one machine.
//
// This is a genuinely new implementation (the legacy version's storage
// layer doesn't translate), not a line-for-line port -- the request/response
// contracts (manifest fields, hash checks, chunk size limit) match the
// original exactly so the existing frontend offline-upload client code
// doesn't need to change.

const CHUNK_SIZE_BYTES = 1024 * 1024
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

type Manifest = {
  uploadId: string
  size: number
  chunkCount: number
  sha256: string
  fileName?: string
  mime?: string
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data instanceof Uint8Array ? data : new Uint8Array(data))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

export class SyncUploadSession {
  private state: DurableObjectState
  private env: Env

  constructor(state: DurableObjectState, env: Env) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/init') {
      return this.handleInit(request)
    }
    if (request.method === 'POST' && url.pathname === '/chunk') {
      return this.handleChunk(request)
    }
    if (request.method === 'POST' && url.pathname === '/complete') {
      return this.handleComplete(request)
    }
    return jsonResponse({ success: false, code: 'not_found' }, 404)
  }

  private async handleInit(request: Request): Promise<Response> {
    const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const manifestInput = (body.manifest || body) as Record<string, unknown>
    const uploadId = String(manifestInput.upload_id || manifestInput.uploadId || '').trim()
    const size = Number(manifestInput.size || 0)
    const chunkCount = Number(manifestInput.chunk_count ?? manifestInput.chunkCount ?? 0)
    const fileHash = String(manifestInput.sha256 || '').trim().toLowerCase()
    const chunkSize = Number(manifestInput.chunk_size ?? manifestInput.chunkSize ?? CHUNK_SIZE_BYTES)

    if (!uploadId || !size || !chunkCount || !/^[a-f0-9]{64}$/.test(fileHash)) {
      return jsonResponse({ success: false, code: 'invalid_manifest', error: 'File sync manifest is invalid.' }, 400)
    }
    if (chunkSize !== CHUNK_SIZE_BYTES) {
      return jsonResponse({ success: false, code: 'invalid_chunk_size', chunkSize: CHUNK_SIZE_BYTES }, 400)
    }
    if (size > MAX_UPLOAD_BYTES) {
      return jsonResponse({ success: false, code: 'file_too_large', maxBytes: MAX_UPLOAD_BYTES }, 413)
    }

    const manifest: Manifest = {
      uploadId,
      size,
      chunkCount,
      sha256: fileHash,
      fileName: String(manifestInput.file_name || manifestInput.fileName || 'offline-upload.bin'),
      mime: String(manifestInput.mime || manifestInput.mime_type || manifestInput.mimeType || ''),
    }
    // A fresh /init for an uploadId that already has state (e.g. the client
    // retried after a dropped connection) resets progress rather than
    // silently keeping stale chunks from a previous attempt.
    await this.state.storage.deleteAll()
    await this.state.storage.put('manifest', manifest)
    await this.state.storage.put('receivedCount', 0)

    return jsonResponse({ success: true, uploadId, chunkSize: CHUNK_SIZE_BYTES })
  }

  private async handleChunk(request: Request): Promise<Response> {
    const manifest = await this.state.storage.get<Manifest>('manifest')
    if (!manifest) return jsonResponse({ success: false, code: 'upload_not_found' }, 404)

    const body = await request.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
    const chunkIndex = Number(body.chunk_index ?? body.chunkIndex ?? -1)
    const chunkSha256 = String(body.chunk_sha256 || body.chunkSha256 || '').trim().toLowerCase()
    const encoded = String(body.chunk || body.encrypted_chunk || '')
    if (chunkIndex < 0 || chunkIndex >= manifest.chunkCount || !/^[a-f0-9]{64}$/.test(chunkSha256) || !encoded) {
      return jsonResponse({ success: false, code: 'invalid_chunk' }, 400)
    }

    let buffer: Uint8Array
    try {
      buffer = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))
    } catch {
      return jsonResponse({ success: false, code: 'invalid_chunk_encoding' }, 400)
    }
    if (!buffer.length || buffer.length > CHUNK_SIZE_BYTES) {
      return jsonResponse({ success: false, code: 'chunk_too_large', chunkSize: CHUNK_SIZE_BYTES }, 413)
    }
    if ((await sha256Hex(buffer)) !== chunkSha256) {
      return jsonResponse({ success: false, code: 'chunk_hash_mismatch' }, 400)
    }

    const alreadyHad = await this.state.storage.get(`chunk:${chunkIndex}`)
    await this.state.storage.put(`chunk:${chunkIndex}`, buffer)
    if (!alreadyHad) {
      const receivedCount = (await this.state.storage.get<number>('receivedCount')) || 0
      await this.state.storage.put('receivedCount', receivedCount + 1)
    }

    return jsonResponse({ success: true, uploadId: manifest.uploadId, chunkIndex })
  }

  private async handleComplete(_request: Request): Promise<Response> {
    const manifest = await this.state.storage.get<Manifest>('manifest')
    if (!manifest) return jsonResponse({ success: false, code: 'upload_not_found' }, 404)

    const chunks: Uint8Array[] = []
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const chunk = await this.state.storage.get<Uint8Array>(`chunk:${index}`)
      if (!chunk) return jsonResponse({ success: false, code: 'missing_chunk', chunkIndex: index }, 409)
      chunks.push(chunk)
    }

    const total = new Uint8Array(manifest.size)
    let offset = 0
    for (const chunk of chunks) {
      total.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (offset !== manifest.size || (await sha256Hex(total)) !== manifest.sha256) {
      return jsonResponse({ success: false, code: 'file_hash_mismatch' }, 400)
    }

    // Reuse the exact same R2 object-key + file_assets row shape as the
    // direct /api/files/upload path (see routes/files.ts) so a
    // reassembled offline upload shows up identically in the Files
    // library -- same public path pattern, same DB row shape.
    const originalName = sanitizeOriginalFileName(manifest.fileName || 'offline-upload.bin')
    const mimeType = manifest.mime || 'application/octet-stream'
    const mediaType = getMediaType(mimeType, originalName)
    const storedName = buildUniqueStoredName(originalName)
    const objectKey = `uploads/${storedName}`

    await this.env.ASSETS.put(objectKey, total, { httpMetadata: { contentType: mimeType } })

    const db = getDb(this.env)
    const insert = await db.prepare(`
      INSERT INTO file_assets (
        original_name, stored_name, public_path, mime_type, media_type, byte_size,
        source, optimization_status
      ) VALUES (@original_name, @stored_name, @public_path, @mime_type, @media_type, @byte_size,
        'offline_sync', @optimization_status)
    `).run({
      original_name: originalName,
      stored_name: storedName,
      public_path: `/uploads/${storedName}`,
      mime_type: mimeType,
      media_type: mediaType,
      byte_size: total.byteLength,
      optimization_status: mediaType === 'image' ? 'not_applicable_no_sharp' : 'not_applicable',
    })
    const asset = await db.prepare('SELECT * FROM file_assets WHERE id = ?').get([insert.lastInsertRowid])

    // Free the staged chunks now that the file is durably in R2 + D1 --
    // no reason to keep paying DO storage for bytes that now live in R2.
    await this.state.storage.deleteAll()

    return jsonResponse({ success: true, uploadId: manifest.uploadId, size: total.byteLength, sha256: manifest.sha256, asset })
  }
}
