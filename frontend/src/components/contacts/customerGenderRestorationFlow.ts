export const CUSTOMER_GENDER_RESTORATION_CAMPAIGN = 'customer-gender-source-20260912-v1'
export const CUSTOMER_GENDER_RESTORATION_TOTAL = 4162
export const CUSTOMER_GENDER_RESTORATION_CHUNKS = 84
export const CUSTOMER_GENDER_RESTORATION_MAX_FILE_BYTES = 8_000_000

export type GenderRestorationChunk = {
  version: 1
  campaign_id: string
  chunk_index: number
  chunk_digest: string
  rows: Array<Record<string, unknown>>
}

export type GenderRestorationFile = {
  version: 1
  campaign_id: string
  total_count: number
  chunks: GenderRestorationChunk[]
}

export type GenderRestorationReceipt = {
  operation_id: string
  chunk_index: number
  count: number
  status: 'ready' | 'applied' | 'reversed'
  generation: number
  history_id: number | null
  replayed?: boolean
}

export type GenderRestorationStatus = {
  success: true
  campaign_id: string
  total_count: number
  chunk_count: number
  receipts: GenderRestorationReceipt[]
}

const exactKeys = (value: Record<string, unknown>, expected: string[]): boolean =>
  Object.keys(value).sort().join('|') === [...expected].sort().join('|')
const BEFORE_KEYS = ['name', 'phone', 'phone_normalized', 'membership_number', 'is_anonymous', 'address', 'updated_at', 'gender']

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseCustomerGenderRestorationFile(text: string): GenderRestorationFile {
  if (!text.trim()) throw new Error('The restoration file is empty.')
  if (new TextEncoder().encode(text).byteLength > CUSTOMER_GENDER_RESTORATION_MAX_FILE_BYTES) {
    throw new Error('The restoration file is larger than the supported manifest limit.')
  }
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('The restoration file is not valid JSON.') }
  if (!isObject(raw) || !exactKeys(raw, ['version', 'campaign_id', 'total_count', 'chunks'])) {
    throw new Error('This is not an approved customer gender restoration file.')
  }
  if (raw.version !== 1 || raw.campaign_id !== CUSTOMER_GENDER_RESTORATION_CAMPAIGN
    || raw.total_count !== CUSTOMER_GENDER_RESTORATION_TOTAL || !Array.isArray(raw.chunks)
    || raw.chunks.length !== CUSTOMER_GENDER_RESTORATION_CHUNKS) {
    throw new Error('This restoration campaign or record count is not approved.')
  }
  const chunks = raw.chunks as unknown[]
  const indices = new Set<number>()
  const customerIds = new Set<number>()
  let rowCount = 0
  for (const rawChunk of chunks) {
    if (!isObject(rawChunk) || !exactKeys(rawChunk, ['version', 'campaign_id', 'chunk_index', 'chunk_digest', 'rows'])
      || rawChunk.version !== 1 || rawChunk.campaign_id !== CUSTOMER_GENDER_RESTORATION_CAMPAIGN
      || !Number.isSafeInteger(rawChunk.chunk_index) || Number(rawChunk.chunk_index) < 0
      || Number(rawChunk.chunk_index) >= CUSTOMER_GENDER_RESTORATION_CHUNKS || indices.has(Number(rawChunk.chunk_index))
      || typeof rawChunk.chunk_digest !== 'string' || !/^sha256-[a-f0-9]{64}$/.test(rawChunk.chunk_digest)
      || !Array.isArray(rawChunk.rows) || rawChunk.rows.length < 1 || rawChunk.rows.length > 50) {
      throw new Error('A restoration chunk is malformed or duplicated.')
    }
    indices.add(Number(rawChunk.chunk_index))
    rowCount += rawChunk.rows.length
    for (const rawRow of rawChunk.rows) {
      if (!isObject(rawRow) || !exactKeys(rawRow, ['id', 'to_gender', 'before', 'match'])
        || !Number.isSafeInteger(rawRow.id) || Number(rawRow.id) <= 0 || customerIds.has(Number(rawRow.id))
        || [22305, 24969].includes(Number(rawRow.id)) || !['female', 'male'].includes(String(rawRow.to_gender))
        || !isObject(rawRow.before) || !exactKeys(rawRow.before, BEFORE_KEYS)
        || !BEFORE_KEYS.every((key) => rawRow.before[key] === null || (key === 'is_anonymous' ? typeof rawRow.before[key] === 'number' && Number.isFinite(rawRow.before[key]) : typeof rawRow.before[key] === 'string'))
        || Boolean(String(rawRow.before.gender || '').trim()) || Number(rawRow.before.is_anonymous || 0) !== 0
        || String(rawRow.before.name || '').trim().toLowerCase() === 'general'
        || !isObject(rawRow.match) || !exactKeys(rawRow.match, ['kind', 'key'])
        || !['unique_phone', 'name_phone', 'name_address'].includes(String(rawRow.match.kind))
        || typeof rawRow.match.key !== 'string' || !rawRow.match.key.length) {
        throw new Error('A restoration record is malformed or duplicated.')
      }
      customerIds.add(Number(rawRow.id))
    }
  }
  if (rowCount !== CUSTOMER_GENDER_RESTORATION_TOTAL || indices.size !== CUSTOMER_GENDER_RESTORATION_CHUNKS) {
    throw new Error('The restoration file is incomplete.')
  }
  return raw as GenderRestorationFile
}

export function receiptMap(status: GenderRestorationStatus): Map<number, GenderRestorationReceipt> {
  return new Map(status.receipts.map((receipt) => [receipt.chunk_index, receipt]))
}

export function appliedRecordCount(status: GenderRestorationStatus | null): number {
  return status?.receipts.reduce((sum, receipt) => sum + (receipt.status === 'applied' ? receipt.count : 0), 0) || 0
}

export type ExecuteChunkResult =
  | { kind: 'applied'; receipt: GenderRestorationReceipt; status?: GenderRestorationStatus }
  | { kind: 'stale' }
  | { kind: 'unknown'; error: unknown; status?: GenderRestorationStatus }
  | { kind: 'failed'; error: unknown }

export function claimGenderRestorationAction(ref: { current: boolean }): boolean {
  if (ref.current) return false
  ref.current = true
  return true
}

export function releaseGenderRestorationAction(ref: { current: boolean }): void {
  ref.current = false
}

/** React StrictMode intentionally runs setup -> cleanup -> setup in development.
 * Setup must revive this component instance rather than relying on a one-time
 * ref initializer. */
export function activateGenderRestorationLifecycle(
  aliveRef: { current: boolean },
  generationRef: { current: number },
): () => void {
  aliveRef.current = true
  return () => {
    aliveRef.current = false
    generationRef.current += 1
  }
}

type ExecuteChunkOptions = {
  chunk: GenderRestorationChunk
  isCurrent: () => boolean
  preview: (chunk: GenderRestorationChunk) => Promise<GenderRestorationReceipt>
  apply: (chunk: GenderRestorationChunk) => Promise<GenderRestorationReceipt>
  status: () => Promise<GenderRestorationStatus>
}

/** One callback-owned unit: fresh preview, then exact apply. An unknown write is
 * resolved by a receipt read only; this helper never automatically replays it. */
export async function executeCustomerGenderRestorationChunk(options: ExecuteChunkOptions): Promise<ExecuteChunkResult> {
  try {
    const preview = await options.preview(options.chunk)
    if (!options.isCurrent()) return { kind: 'stale' }
    if (preview.status === 'reversed') return { kind: 'failed', error: new Error('This chunk was undone. Use Records to redo it.') }
    if (preview.status === 'applied') return { kind: 'applied', receipt: preview }
    if (preview.status !== 'ready') return { kind: 'failed', error: new Error('The server did not approve this chunk for apply.') }
    try {
      const receipt = await options.apply(options.chunk)
      if (!options.isCurrent()) return { kind: 'stale' }
      return receipt.status === 'applied'
        ? { kind: 'applied', receipt }
        : { kind: 'failed', error: new Error('The server did not return an applied receipt.') }
    } catch (error) {
      if (!options.isCurrent()) return { kind: 'stale' }
      if ((error as { outcome?: unknown } | null)?.outcome !== 'unknown'
        && Number((error as { status?: unknown } | null)?.status) !== 503) return { kind: 'failed', error }
      try {
        const status = await options.status()
        if (!options.isCurrent()) return { kind: 'stale' }
        const receipt = receiptMap(status).get(options.chunk.chunk_index)
        return receipt?.status === 'applied'
          ? { kind: 'applied', receipt, status }
          : { kind: 'unknown', error, status }
      } catch {
        if (!options.isCurrent()) return { kind: 'stale' }
        return { kind: 'unknown', error }
      }
    }
  } catch (error) {
    return options.isCurrent() ? { kind: 'failed', error } : { kind: 'stale' }
  }
}
