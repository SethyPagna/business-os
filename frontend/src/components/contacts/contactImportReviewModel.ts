export type ContactConflictFilter = 'all' | 'name' | 'phone'
export type ContactReviewSort = 'name_asc' | 'name_desc' | 'row_asc' | 'row_desc'
export type ContactRowChoice = 'merge' | 'different' | 'delete'

export const CONTACT_REVIEW_PAGE_SIZE = 50

export function contactConflictWarningKinds(filter: ContactConflictFilter): string {
  if (filter === 'name') return 'name_match'
  if (filter === 'phone') return 'membership_phone_conflict'
  return 'name_match,membership_phone_conflict'
}

export function contactReviewPageCount(total: unknown): number {
  const count = Math.max(0, Number(total) || 0)
  return Math.max(1, Math.ceil(count / CONTACT_REVIEW_PAGE_SIZE))
}

export function restoreContactRowDecision(decision: unknown): {
  choice?: ContactRowChoice
  rename?: string
  resolved: boolean
} {
  if (!decision || typeof decision !== 'object') return { resolved: false }
  const value = decision as { action?: unknown; field_overrides?: { name?: unknown } }
  if (value.action === 'apply') return { choice: 'merge', resolved: true }
  if (value.action === 'skip') return { choice: 'delete', resolved: true }
  if (value.action === 'force_create') {
    const rename = typeof value.field_overrides?.name === 'string' ? value.field_overrides.name : undefined
    return { choice: 'different', rename, resolved: true }
  }
  return { resolved: false }
}
