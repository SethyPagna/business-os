import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import FilterMenu, { type FilterOption, type FilterSection } from '../shared/FilterMenu.tsx'
import type { InventoryCheckSession } from '../../api/inventoryChecksTransport.ts'
import { fmtDate, fmtDateTime24 } from '../../utils/formatters.ts'

type Translator = (key: string) => string | null | undefined
const label = (t: Translator, key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }

export type SessionListFilters = { status: '' | 'open' | 'closed'; mine: boolean }
export const initialSessionFilters: SessionListFilters = { status: '', mine: false }

/** "dd/mm/yyyy · Branch": the name is built from the session's own start and branch, so it follows the viewer's language and never reads the stored title. */
export function sessionDisplayName(session: Pick<InventoryCheckSession, 'started_at'>, branchName?: string | null): string {
  return [fmtDate(session.started_at), branchName].filter(Boolean).join(' · ')
}

export function SessionStatusChip({ status, t }: { status: InventoryCheckSession['status']; t: Translator }) {
  const open = status === 'open'
  return <span data-session-status={status} className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold leading-relaxed ${open ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-gray-300'}`}>
    {open ? label(t, 'open', 'Open') : label(t, 'shift_status_closed', 'Closed')}
  </span>
}

type Progress = NonNullable<InventoryCheckSession['progress']>

/** Checked / total as a ring: emerald for done, amber for issues, a grey track for what is left. */
export function ProgressRing({ progress, t }: { progress: Progress; t: Translator }) {
  const total = Math.max(0, progress.total)
  const checked = Math.min(total, progress.done + progress.issue)
  const radius = 9, circumference = 2 * Math.PI * radius
  const share = (count: number) => total > 0 ? Math.min(count, total) / total * circumference : 0
  const done = share(progress.done), issue = share(progress.issue)
  const named = `${label(t, 'inventory_check_progress', 'Checked')} ${checked}/${total}`
  return <span data-session-progress className="inline-flex shrink-0 items-center gap-1 tabular-nums">
    <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label={named} className="shrink-0 -rotate-90">
      <circle cx="12" cy="12" r={radius} fill="none" strokeWidth="3" className="stroke-gray-200 dark:stroke-zinc-700" />
      {done > 0 ? <circle data-ring-arc="done" cx="12" cy="12" r={radius} fill="none" strokeWidth="3" strokeDasharray={`${done} ${circumference}`} className="stroke-emerald-500" /> : null}
      {issue > 0 ? <circle data-ring-arc="issue" cx="12" cy="12" r={radius} fill="none" strokeWidth="3" strokeDasharray={`${issue} ${circumference}`} strokeDashoffset={-done} className="stroke-amber-500" /> : null}
    </svg>
    <span aria-hidden="true">{checked}/{total}</span>
  </span>
}

/** ✓done  !issue, each figure named for tooltips and screen readers; what is left is the ring's grey. */
export function SessionCounts({ progress, t }: { progress: Progress; t: Translator }) {
  const done = label(t, 'inventory_check_done', 'Done'), issue = label(t, 'inventory_check_issue', 'Issue')
  return <span data-session-counts className="inline-flex shrink-0 items-center gap-2 tabular-nums">
    <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-300" title={done} aria-label={`${done}: ${progress.done}`}><Check className="h-3.5 w-3.5" aria-hidden="true" />{progress.done}</span>
    <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-300" title={issue} aria-label={`${issue}: ${progress.issue}`}><AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />{progress.issue}</span>
  </span>
}

export default function InventoryCheckSessionsList({ items, onOpen, t }: { items: readonly InventoryCheckSession[]; onOpen: (session: InventoryCheckSession) => void; t: Translator }) {
  return <ul className="min-w-0 divide-y" aria-label={label(t, 'inventory_check_sessions', 'Count sessions')}>
    {items.map(item => <li key={item.id} data-inventory-check-session={item.id} className="min-w-0">
      <button type="button" className="flex min-h-10 w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-2 text-left text-xs" onClick={() => onOpen(item)}>
        <SessionStatusChip status={item.status} t={t} />
        <span className="font-semibold">{fmtDateTime24(item.started_at)}</span>
        {item.branch_name ? <span className="detail-scroll-text min-w-0 leading-relaxed">{item.branch_name}</span> : null}
        {item.creator_name ? <span className="text-gray-500" title={label(t, 'inventory_check_created_by', 'Created by')}>@{item.creator_name}</span> : null}
        {item.progress ? <><ProgressRing progress={item.progress} t={t} /><SessionCounts progress={item.progress} t={t} /></> : null}
        {item.status === 'closed' && item.closed_at ? <span className="text-gray-500">{label(t, 'shift_status_closed', 'Closed')} {fmtDateTime24(item.closed_at)}</span> : null}
      </button>
    </li>)}
  </ul>
}

/** The Sessions tab's one Filters menu: Open/Closed and Mine, plus Branch when the viewer has more than one. */
export function InventoryCheckSessionFilterMenu({ value, onChange, branches, branchId, onBranchChange, onClear, t }: {
  value: SessionListFilters
  onChange: (patch: Partial<SessionListFilters>) => void
  branches: ReadonlyArray<{ id: number; name: string }>
  branchId: string
  onBranchChange: (branchId: string) => void
  onClear: () => void
  t: Translator
}) {
  const choice = (id: string, text: string, active: boolean, onClick: () => void): FilterOption => ({ id, label: text, active, onClick })
  const branchChosen = branches.length > 1 && branchId !== ''
  const sections = ([
    { id: 'status', label: label(t, 'status', 'Status'), options: [
      choice('all', label(t, 'all', 'All'), value.status === '', () => onChange({ status: '' })),
      choice('open', label(t, 'open', 'Open'), value.status === 'open', () => onChange({ status: 'open' })),
      choice('closed', label(t, 'shift_status_closed', 'Closed'), value.status === 'closed', () => onChange({ status: 'closed' })),
    ] },
    { id: 'creator', label: label(t, 'inventory_check_created_by', 'Created by'), options: [
      choice('all', label(t, 'all', 'All'), !value.mine, () => onChange({ mine: false })),
      choice('mine', label(t, 'inventory_check_filter_creator_mine', 'Mine'), value.mine, () => onChange({ mine: true })),
    ] },
    branches.length > 1 ? { id: 'branch', label: label(t, 'branch', 'Branch'), searchable: true, options: [
      choice('all', label(t, 'all_branches', 'All Branches'), branchId === '', () => onBranchChange('')),
      ...branches.map(branch => choice(String(branch.id), branch.name, branchId === String(branch.id), () => onBranchChange(String(branch.id)))),
    ] } : null,
  ] as Array<FilterSection | null>).filter((section): section is FilterSection => section !== null)
  const activeCount = (value.status ? 1 : 0) + (value.mine ? 1 : 0) + (branchChosen ? 1 : 0)
  return <FilterMenu label={label(t, 'filters', 'Filters')} activeCount={activeCount} sections={sections} onClear={onClear} iconOnly large />
}
