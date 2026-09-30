// The Audit Log page's filter state and the request it sends, kept pure (no
// React, no DOM) so the rules are testable: tests/auditLogView.test.ts.
//
// The page is organised three ways -- All, by Section, by User -- with a time
// window and a search. Two invariants matter for the Worker's read budget:
//   - a request always names a bounded business-day window (Cambodia days
//     derived from the business "today", never the device clock);
//   - the per-section / per-user counts are asked for on the FIRST page only.

export type AuditScope = 'all' | 'section' | 'user'
export type AuditTimePreset = 'today' | '7d' | '30d' | 'custom'
export type AuditOrder = 'asc' | 'desc'

export const AUDIT_SCOPES: readonly AuditScope[] = ['all', 'section', 'user']
export const AUDIT_TIME_PRESETS: readonly AuditTimePreset[] = ['today', '7d', '30d', 'custom']

// Same ids, same order as cloudflare/src/lib/auditSections.ts (tests pin it).
export const AUDIT_SECTION_IDS = [
  'sales', 'products', 'contacts', 'users', 'settings', 'expenses', 'returns', 'website', 'system', 'other',
] as const

export const AUDIT_SECTION_FALLBACKS: Record<string, string> = {
  sales: 'Sales',
  products: 'Products & stock',
  contacts: 'Contacts',
  users: 'Users & permissions',
  settings: 'Settings',
  expenses: 'Expenses',
  returns: 'Returns',
  website: 'Website',
  system: 'System',
  other: 'Other',
}

export const AUDIT_PAGE_SIZE = 50
const WINDOW_DAYS: Record<Exclude<AuditTimePreset, 'custom'>, number> = { today: 1, '7d': 7, '30d': 30 }

export interface AuditViewState {
  scope: AuditScope
  preset: AuditTimePreset
  rangeStart: string
  rangeEnd: string
  search: string
  /** 'all' or a comma list of section ids (used only in Section scope). */
  section: string
  /** 'all' or a comma list of account ids (used only in User scope). */
  userId: string
  /** 'all' or a comma list of action keys. */
  action: string
  order: AuditOrder
}

export type AuditRequestParams = Record<string, string | number | undefined>

export function initialAuditViewState(): AuditViewState {
  return {
    scope: 'all',
    preset: 'today',
    rangeStart: '',
    rangeEnd: '',
    search: '',
    section: 'all',
    userId: 'all',
    action: 'all',
    order: 'desc',
  }
}

function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10)
}

/** [today - (days - 1), today], both inclusive, on the business calendar. */
export function auditPresetWindow(preset: Exclude<AuditTimePreset, 'custom'>, today: string): { startDate: string; endDate: string } {
  return { startDate: shiftDay(today, -(WINDOW_DAYS[preset] - 1)), endDate: today }
}

export function auditWindowFor(state: AuditViewState, today: string): { startDate: string; endDate: string } {
  if (state.preset !== 'custom') return auditPresetWindow(state.preset, today)
  if (!state.rangeStart && !state.rangeEnd) return auditPresetWindow('30d', today)
  return {
    startDate: state.rangeStart || auditPresetWindow('30d', state.rangeEnd || today).startDate,
    endDate: state.rangeEnd || today,
  }
}

export function auditCountsFor(scope: AuditScope): 'sections' | 'users' | undefined {
  if (scope === 'section') return 'sections'
  if (scope === 'user') return 'users'
  return undefined
}

export function setAuditScope(state: AuditViewState, scope: AuditScope, canSeeAllUsers: boolean): AuditViewState {
  const next: AuditScope = scope === 'user' && !canSeeAllUsers ? 'all' : scope
  return {
    ...state,
    scope: next,
    section: next === 'section' ? state.section : 'all',
    userId: next === 'user' ? state.userId : 'all',
  }
}

export function setAuditPreset(state: AuditViewState, preset: AuditTimePreset, today: string): AuditViewState {
  if (preset !== 'custom') return { ...state, preset }
  const shown = auditWindowFor(state, today)
  return { ...state, preset, rangeStart: shown.startDate, rangeEnd: shown.endDate }
}

export function setAuditRange(state: AuditViewState, rangeStart: string, rangeEnd: string): AuditViewState {
  return { ...state, preset: 'custom', rangeStart, rangeEnd }
}

export function buildAuditRequestParams(
  state: AuditViewState,
  options: { today: string; cursor?: string; pageSize?: number },
): AuditRequestParams {
  const window = auditWindowFor(state, options.today)
  const search = state.search.trim()
  const cursor = options.cursor || undefined
  return {
    pageSize: options.pageSize ?? AUDIT_PAGE_SIZE,
    startDate: window.startDate,
    endDate: window.endDate,
    search: search || undefined,
    section: state.scope === 'section' && state.section !== 'all' ? state.section : undefined,
    userId: state.scope === 'user' && state.userId !== 'all' ? state.userId : undefined,
    action: state.action !== 'all' ? state.action : undefined,
    order: state.order === 'asc' ? 'asc' : undefined,
    cursor,
    counts: cursor ? undefined : auditCountsFor(state.scope),
  }
}

/** Changes when the result set changes; not when only the page does. */
export function auditFilterKey(state: AuditViewState, today: string): string {
  const { pageSize: _pageSize, ...rest } = buildAuditRequestParams(state, { today })
  return JSON.stringify(rest)
}

export function mergeAuditRows<T extends { id?: string | number | null }>(current: T[], incoming: T[]): T[] {
  if (!incoming.length) return current
  const seen = new Set(current.map((row) => String(row.id)))
  const fresh = incoming.filter((row) => !seen.has(String(row.id)))
  return fresh.length ? [...current, ...fresh] : current
}
