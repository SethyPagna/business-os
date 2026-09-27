// The website assistant's two private settings in the Website Editor
// (FX-sec2, refuter R-sec F2, 27 Sep 2026).
//
// The public website config never carries the assistant's prompt or its
// provider id (cloudflare/src/routes/portal.ts buildPublicPortalConfig), so
// the editor cannot learn them from the website it loads, and the app's
// settings map cannot say whether it holds the server's values, nothing yet,
// or only this device's keys. The editor therefore reads both from the
// server's own settings answer, keeps the fields and Save locked until that
// read settles, and sends a key only when the person changed it. A key
// changed to blank is also named in `clearKeys`, the Worker's explicit clear
// list: cloudflare/src/routes/settings.ts keeps any other blank as stored.
export const PRIVATE_AI_SETTING_KEYS = ['customer_portal_ai_prompt', 'customer_portal_ai_provider_id'] as const
export type PrivateAiKey = (typeof PRIVATE_AI_SETTING_KEYS)[number]
export type PrivateAiValues = Record<PrivateAiKey, string>
// loading: the server has not answered; the fields are locked and Save waits.
// loaded:  `values` is what the server holds; edits are measured against it.
// failed:  the read failed before anything loaded; the fields stay locked and
//          a save carries neither key, so the rest of the website still saves.
export type PrivateAiStatus = 'loading' | 'loaded' | 'failed'
export type PrivateAiState = {
  status: PrivateAiStatus
  values: PrivateAiValues
  edits: Partial<PrivateAiValues>
}

const EMPTY_VALUES: PrivateAiValues = { customer_portal_ai_prompt: '', customer_portal_ai_provider_id: '' }

export function createPrivateAiState(): PrivateAiState {
  return { status: 'loading', values: { ...EMPTY_VALUES }, edits: {} }
}

export function isPrivateAiKey(key: string): key is PrivateAiKey {
  return (PRIVATE_AI_SETTING_KEYS as readonly string[]).includes(key)
}

// The form stored and edited values are compared in: the prompt trimmed, the
// provider a positive whole-number id or '' (Automatic).
export function normalizePrivateAiValue(key: PrivateAiKey, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (key === 'customer_portal_ai_provider_id') {
    const id = Number(value)
    return Number.isInteger(id) && id > 0 ? String(id) : ''
  }
  return String(value).trim()
}

// Anything but a settings object is a failed read, never "nothing stored". A
// failure after the values loaded keeps them. A later answer moves the
// baseline and leaves the person's unsaved edits as they typed them.
export function applyPrivateAiRead(state: PrivateAiState, settings: unknown): PrivateAiState {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return state.status === 'loaded' ? state : { ...state, status: 'failed' }
  }
  const stored = settings as Record<string, unknown>
  const values = { ...EMPTY_VALUES }
  for (const key of PRIVATE_AI_SETTING_KEYS) values[key] = normalizePrivateAiValue(key, stored[key])
  return { status: 'loaded', values, edits: state.edits }
}

// A value the editor has not seen cannot be edited.
export function editPrivateAi(state: PrivateAiState, key: PrivateAiKey, value: unknown): PrivateAiState {
  if (state.status !== 'loaded') return state
  return { ...state, edits: { ...state.edits, [key]: String(value ?? '') } }
}

export function privateAiFormValues(state: PrivateAiState): PrivateAiValues {
  return state.status === 'loaded' ? { ...state.values, ...state.edits } : { ...EMPTY_VALUES }
}

export function privateAiBlocksSave(state: PrivateAiState): boolean {
  return state.status === 'loading'
}

export function privateAiSaveChanges(state: PrivateAiState): { updates: Partial<PrivateAiValues>; clearKeys: PrivateAiKey[] } {
  const updates: Partial<PrivateAiValues> = {}
  const clearKeys: PrivateAiKey[] = []
  if (state.status !== 'loaded') return { updates, clearKeys }
  for (const key of PRIVATE_AI_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(state.edits, key)) continue
    const next = normalizePrivateAiValue(key, state.edits[key])
    if (next === state.values[key]) continue
    updates[key] = next
    if (next === '') clearKeys.push(key)
  }
  return { updates, clearKeys }
}

// After a save lands, what it sent is the stored value, and an edit it
// carried is done; an edit typed while the save was in flight stays pending.
export function settlePrivateAiSave(state: PrivateAiState, sent: Record<string, unknown>): PrivateAiState {
  if (state.status !== 'loaded') return state
  const values = { ...state.values }
  const edits = { ...state.edits }
  for (const key of PRIVATE_AI_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(sent, key)) continue
    values[key] = normalizePrivateAiValue(key, sent[key])
    if (Object.prototype.hasOwnProperty.call(edits, key) && normalizePrivateAiValue(key, edits[key]) === values[key]) delete edits[key]
  }
  return { status: 'loaded', values, edits }
}
