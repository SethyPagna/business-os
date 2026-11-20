import type { InventoryCheckTask, InventoryCheckTaskScope } from '../../api/inventoryChecksTransport.ts'
import { fmtDate, fmtDateTime24 } from '../../utils/formatters.ts'
import { dayLabel } from './inventoryCheckDays.ts'
import type { InventoryCheckFilters } from './InventoryCheckControls.tsx'
import { describeCountScope } from './inventoryCheckScopeText.ts'

type Translator = (key: string) => string | null | undefined
const label = (t: Translator, key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
const emptyFilters: InventoryCheckFilters = { branchId: '', stockState: '', checkState: '', checkedOn: '', brand: '', category: '', sortBy: 'name', sortDirection: 'asc', group: '' }

/** The filters a task was issued with (or are about to be), in words: search, state, stock, brand, category and the last-checked day. */
export function filterScopeText(t: Translator, query: string, filters: Partial<InventoryCheckFilters>): string {
  const text = describeCountScope(key => label(t, key, key), { query, filters: { ...emptyFilters, ...filters }, stateApplies: true })
  const day = filters.checkedOn ? `${label(t, 'inventory_check_days_label', 'Last checked on')}: ${dayLabel(filters.checkedOn)}` : ''
  return [text, day].filter(Boolean).join(' · ')
}

/** The row's name: its title when it has one, else "dd/mm/yyyy · what it holds", built in the viewer's language (like a count session's name). */
export function taskName(t: Translator, task: Pick<InventoryCheckTask, 'title' | 'issued_at' | 'selection' | 'total'>): string {
  if (task.title && task.title.trim()) return task.title.trim()
  const selection = task.selection
  const scope = selection?.kind === 'filters'
    ? filterScopeText(t, typeof selection.filters.query === 'string' ? selection.filters.query : '', selection.filters as Partial<InventoryCheckFilters>)
    : `${label(t, 'products', 'Products')}: ${task.total}`
  return [fmtDate(task.issued_at), scope].filter(Boolean).join(' · ')
}

export function progressText(t: Translator, counts: { total: number; done: number }): string {
  return label(t, 'inventory_check_task_progress', '{done}/{total} counted').replace('{done}', String(counts.done)).replace('{total}', String(counts.total))
}

/** "{done}/{total} counted"; "All counted" for an open task whose products are all counted; "{done}/{total} counted at close" for a closed task (its figures are the ones it closed with). */
export function progressOrAllText(t: Translator, task: { total: number; done: number; status: 'open' | 'closed' }): string {
  if (task.status === 'closed') return label(t, 'inventory_check_task_progress_closed', '{done}/{total} counted at close').replace('{done}', String(task.done)).replace('{total}', String(task.total))
  return task.done >= task.total ? label(t, 'inventory_check_task_all_counted', 'All counted') : progressText(t, task)
}

export function removedText(t: Translator, count: number): string {
  return label(t, 'inventory_check_task_removed', '{count} removed').replace('{count}', String(count))
}

/** The Worker's `reopened` note on a board row (absent from a Worker that does not send it, and `by` for a viewer who may not see staff identity). */
export type TaskReopened = { at: string; reason: string; by?: string }

/** "Reopened: why · when · @who": the one line under a task that was reopened because a count it relied on was taken back. */
export function reopenedText(t: Translator, reopened: TaskReopened): string {
  const why = reopened.reason === 'count_reopened' ? label(t, 'inventory_check_task_reopened_count', 'Reopened: a count was taken back')
    : reopened.reason === 'set_undone' ? label(t, 'inventory_check_task_reopened_set', 'Reopened: a stock Set was undone')
      : label(t, 'inventory_check_task_reopened', 'Reopened')
  return [why, fmtDateTime24(reopened.at), typeof reopened.by === 'string' && reopened.by ? `@${reopened.by}` : ''].filter(Boolean).join(' · ')
}

export function pickerText(t: Translator, name: string): string {
  return label(t, 'inventory_check_task_picked_up_by', 'Picked up by {name}').replace('{name}', `@${name}`)
}

/** "{open} open tasks here (limit {limit}). Close one first." */
export function openTasksLimitText(t: Translator, open: number | string, limit: number | string): string {
  return label(t, 'inventory_check_task_limit_count', '{open} open tasks here (limit {limit}). Close one first.').replace('{open}', String(open)).replace('{limit}', String(limit))
}

type Refusal = { code?: unknown; open?: unknown; total?: unknown; limit?: unknown; atLeast?: unknown; pickedUpBy?: unknown; mine?: unknown }
const figure = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? String(value) : null

/**
 * The sentence for a task refusal that carries figures or depends on what was asked (too many, nothing to count, who has it), or null when the
 * ordinary refusal table says it. `scopeKind` is what the issue named.
 */
export function taskRefusalSentence(t: Translator, cause: unknown, scopeKind?: 'ids' | 'filters'): string | null {
  const refusal = (cause ?? {}) as Refusal
  if (refusal.code === 'inventory_check_task_too_many') {
    const total = figure(refusal.total), limit = figure(refusal.limit)
    if (total === null || limit === null) return null
    const key = refusal.atLeast === true ? 'inventory_check_task_too_many_at_least' : 'inventory_check_task_too_many_count'
    return label(t, key, refusal.atLeast === true ? 'At least {total} products. A task holds at most {limit}. Narrow the selection.' : '{total} products. A task holds at most {limit}. Narrow the selection.').replace('{total}', total).replace('{limit}', limit)
  }
  if (refusal.code === 'inventory_check_task_limit') {
    const open = figure(refusal.open), limit = figure(refusal.limit)
    return open === null || limit === null ? null : openTasksLimitText(t, open, limit)
  }
  if (refusal.code === 'inventory_check_product_not_eligible' && scopeKind === 'filters') return label(t, 'inventory_check_task_nothing_to_count', 'No product in these filters can be counted.')
  if (refusal.code === 'inventory_check_task_picked_up' && refusal.mine !== true) {
    return typeof refusal.pickedUpBy === 'string' && refusal.pickedUpBy ? pickerText(t, refusal.pickedUpBy) : null
  }
  return null
}

/** The Worker's own key for the same refusal, kept apart so tests can pin every mapping. */
export function taskRefusalKey(cause: unknown, scopeKind?: 'ids' | 'filters'): string | null {
  const refusal = (cause ?? {}) as Refusal
  if (refusal.code === 'inventory_check_task_too_many' && figure(refusal.total) !== null && figure(refusal.limit) !== null) return refusal.atLeast === true ? 'inventory_check_task_too_many_at_least' : 'inventory_check_task_too_many_count'
  if (refusal.code === 'inventory_check_task_limit' && figure(refusal.open) !== null && figure(refusal.limit) !== null) return 'inventory_check_task_limit_count'
  if (refusal.code === 'inventory_check_product_not_eligible' && scopeKind === 'filters') return 'inventory_check_task_nothing_to_count'
  if (refusal.code === 'inventory_check_task_picked_up' && refusal.mine !== true && typeof refusal.pickedUpBy === 'string' && refusal.pickedUpBy) return 'inventory_check_task_picked_up_by'
  return null
}

/** What an issue sends, from the page's picks or, with none, its filters: empty values are dropped. Null when there is neither. */
export function taskScopeOf(picks: ReadonlySet<number>, list: { query: string; filters: Partial<InventoryCheckFilters> }): InventoryCheckTaskScope | null {
  if (picks.size > 0) return { productIds: [...picks].sort((a, b) => a - b) }
  const found: Record<string, string> = {}
  const add = (key: string, value: unknown) => { if (typeof value === 'string' && value.trim() !== '') found[key] = value.trim() }
  add('query', list.query); add('brand', list.filters.brand); add('category', list.filters.category)
  add('stockState', list.filters.stockState); add('checkState', list.filters.checkState); add('checkedOn', list.filters.checkedOn)
  return Object.keys(found).length ? { filters: found } : null
}

type ReviewItem = { label: string; value: string | number }
export type TaskReview = { title: string; message?: string; items: ReviewItem[]; note?: string; confirmLabel: string; danger?: boolean }
type Counts = Pick<InventoryCheckTask, 'title' | 'issued_at' | 'selection' | 'total' | 'done' | 'status' | 'picked_up_by'>

/**
 * The shared review's content for a task action: every row is known before it opens, so it is drawn whole from the first paint.
 * Rows: Counted (done/total: the total is not repeated as a Products row), the counts not yet submitted (Hand back only) and the Branch.
 * Handing back with typed counts is the red review: its banner says those counts are discarded, and the task's name and its picker move to the footnote.
 */
export function taskReview(t: Translator, kind: 'pickup' | 'close' | 'release', task: Counts, branchName: string | null, draftCount = 0): TaskReview {
  const items: ReviewItem[] = [{ label: label(t, 'inventory_check_counted', 'Counted'), value: `${task.done}/${task.total}` }]
  const discards = kind === 'release' && draftCount > 0
  if (discards) items.push({ label: label(t, 'inventory_check_counts_in_progress', 'Counts not submitted'), value: draftCount })
  items.push({ label: label(t, 'branch', 'Branch'), value: branchName || '—' })
  const name = taskName(t, task), picker = (kind === 'close' || kind === 'release') && task.picked_up_by ? pickerText(t, task.picked_up_by) : ''
  const base = discards
    ? { message: label(t, 'inventory_check_task_release_discards', 'Your typed counts for this task will be discarded.'), items, note: [name, picker].filter(Boolean).join(' · ') }
    : { message: name, items, ...(picker ? { note: picker } : {}) }
  if (kind === 'pickup') return { ...base, title: label(t, 'inventory_check_task_pickup_review_title', 'Pick up this task?'), confirmLabel: label(t, 'inventory_check_task_pickup', 'Pick up') }
  if (kind === 'close') return { ...base, title: label(t, 'inventory_check_task_close_review_title', 'Close this task?'), confirmLabel: label(t, 'inventory_check_task_close', 'Close task') }
  return { ...base, title: label(t, 'inventory_check_task_release_review_title', 'Hand back this task?'), confirmLabel: label(t, 'inventory_check_task_release', 'Hand back'), ...(discards ? { danger: true } : {}) }
}
