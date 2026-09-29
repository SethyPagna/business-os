import type { PrivateAiState } from './portalPrivateAi.ts'

// The storefront config lacks some editor keys, so a Save writes only keys it
// loaded (public config or staff settings) or saw edited.
export type EditorDraft = Record<string, unknown>
export type StaffSettings = Record<string, unknown>
export type EditedKeys = ReadonlySet<string>

// Equal to KNOWN_UNPUBLISHED in cloudflare/scripts/test-portal-about-publish-pure.cjs (checked by portalEditorDraft.test.ts).
export const DRAFT_KEYS_NOT_IN_PUBLIC_CONFIG: ReadonlySet<string> = new Set([
  'customer_portal_title_size',
  'customer_portal_stock_threshold_mode',
  'customer_portal_low_stock_threshold',
  'customer_portal_out_of_stock_threshold',
  'customer_portal_show_point_value',
  'customer_portal_show_membership',
])

const DRAFT_KEYS_WITH_FIXED_VALUES: ReadonlySet<string> = new Set(['customer_portal_show_membership'])
const SWITCH_ON_VALUES = new Set(['1', 'true', 'yes', 'on'])
const SITE_UPLOADS_PREFIX = '/uploads/'
export const ABOUT_IMAGE_REFUSAL_CODE = 'invalid_about_image'
const NO_EDITED_KEYS: EditedKeys = new Set()

const hasOwn = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key)

export function readStaffSettings(value: unknown): StaffSettings | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as StaffSettings : null
}

function storedSwitch(value: unknown, fallback: boolean): boolean {
  const text = String(value ?? '').trim().toLowerCase()
  return text ? SWITCH_ON_VALUES.has(text) : fallback
}

export function overlayStaffSettings(draft: EditorDraft, staff: StaffSettings | null, keepAsTyped: EditedKeys = NO_EDITED_KEYS): EditorDraft {
  if (!staff) return draft
  const next: EditorDraft = { ...draft }
  for (const key of Object.keys(draft)) {
    if (!hasOwn(staff, key) || keepAsTyped.has(key) || DRAFT_KEYS_WITH_FIXED_VALUES.has(key)) continue
    const stored = staff[key]
    next[key] = typeof draft[key] === 'boolean' ? storedSwitch(stored, draft[key] as boolean) : String(stored ?? '')
  }
  return next
}

export function isLoadedOrEditedKey(key: string, staff: StaffSettings | null, edited: EditedKeys): boolean {
  return !DRAFT_KEYS_NOT_IN_PUBLIC_CONFIG.has(key) || edited.has(key) || (staff !== null && hasOwn(staff, key))
}

export function markEdited(edited: EditedKeys, key: string): EditedKeys {
  if (edited.has(key)) return edited
  return new Set([...edited, key])
}

export function settleSavedEdits(edited: EditedKeys, sentDraft: EditorDraft, draftNow: EditorDraft): EditedKeys {
  return new Set([...edited].filter((key) => !hasOwn(sentDraft, key) || !Object.is(sentDraft[key], draftNow[key])))
}

export function replaceDraftValues(draft: EditorDraft, values: EditorDraft): EditorDraft {
  return { ...draft, ...values }
}

export function keepEditedValues(loadedDraft: EditorDraft, currentDraft: EditorDraft, edited: EditedKeys): EditorDraft {
  const next: EditorDraft = { ...loadedDraft }
  for (const key of edited) {
    if (hasOwn(currentDraft, key)) next[key] = currentDraft[key]
  }
  return next
}

export function discardEditorDraft(loadedDraft: EditorDraft, staff: StaffSettings | null, privateAi: PrivateAiState): {
  draft: EditorDraft
  editedKeys: EditedKeys
  privateAi: PrivateAiState
} {
  return {
    draft: overlayStaffSettings(loadedDraft, staff),
    editedKeys: NO_EDITED_KEYS,
    privateAi: { ...privateAi, edits: {} },
  }
}

// resolveUploadUrl is how this site shows an upload path; only a URL it would
// produce for that same path is this site's own upload.
export function siteUploadPath(value: unknown, resolveUploadUrl: (path: string) => string): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  if (raw.startsWith(SITE_UPLOADS_PREFIX)) return raw
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const path = `${url.pathname}${url.search}${url.hash}`
  return url.pathname.startsWith(SITE_UPLOADS_PREFIX) && resolveUploadUrl(path) === raw ? path : null
}

export function isAboutImageRefusal(result: unknown): boolean {
  const error = (result as { error?: { code?: unknown } } | null)?.error
  return error?.code === ABOUT_IMAGE_REFUSAL_CODE
}
