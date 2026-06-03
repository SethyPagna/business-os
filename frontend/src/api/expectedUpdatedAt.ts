export type ExpectedUpdatedAtPayload = Record<string, unknown>

type LocalUpdatedAtRow = {
  updated_at?: unknown
}

type LocalTableReader = {
  get?: (id: unknown) => Promise<LocalUpdatedAtRow | undefined>
}

let localDbPromise: Promise<typeof import('./localDb.ts')> | null = null

function getLocalDbModule(): Promise<typeof import('./localDb.ts')> {
  if (!localDbPromise) localDbPromise = import('./localDb.ts')
  return localDbPromise
}

function hasExpectedUpdatedAt(payload: ExpectedUpdatedAtPayload): boolean {
  return Boolean(payload.expectedUpdatedAt || payload.expected_updated_at)
}

export async function withExpectedUpdatedAt(
  tableName: string,
  id: unknown,
  payload: ExpectedUpdatedAtPayload = {},
): Promise<ExpectedUpdatedAtPayload> {
  const body: ExpectedUpdatedAtPayload = { ...(payload || {}) }
  if (hasExpectedUpdatedAt(body)) return body
  if (body.updated_at) {
    body.expectedUpdatedAt = body.updated_at
    return body
  }
  try {
    const { dexieDb } = await getLocalDbModule()
    const table = (dexieDb as unknown as Record<string, LocalTableReader>)[tableName]
    const row = await table?.get?.(id)
    if (row?.updated_at) body.expectedUpdatedAt = row.updated_at
  } catch (_) {}
  return body
}

export async function withSettingsExpectedUpdatedAt(
  payload: ExpectedUpdatedAtPayload = {},
): Promise<ExpectedUpdatedAtPayload> {
  const body: ExpectedUpdatedAtPayload = { ...(payload || {}) }
  if (hasExpectedUpdatedAt(body)) return body
  try {
    const { localGetSettingsMeta } = await getLocalDbModule()
    const meta = await localGetSettingsMeta()
    if (meta?.updatedAt) body.expectedUpdatedAt = meta.updatedAt
  } catch (_) {}
  return body
}
