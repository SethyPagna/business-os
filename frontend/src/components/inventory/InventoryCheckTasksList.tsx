import ClipboardPlus from 'lucide-react/dist/esm/icons/clipboard-plus.js'
import Hand from 'lucide-react/dist/esm/icons/hand.js'
import Lock from 'lucide-react/dist/esm/icons/lock.js'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Undo2 from 'lucide-react/dist/esm/icons/undo-2.js'
import type { InventoryCheckTask, InventoryCheckTasksAnswer } from '../../api/inventoryChecksTransport.ts'
import { fmtDate, fmtDateTime24 } from '../../utils/formatters.ts'
import FilterMenu, { type FilterSection } from '../shared/FilterMenu.tsx'
import InfoHint from '../shared/InfoHint.tsx'
import SoleBranchLabel from '../shared/SoleBranchLabel.tsx'
import { ProgressRing, SessionStatusChip } from './InventoryCheckSessionsList.tsx'
import { pickerText, progressOrAllText, removedText, reopenedText, taskName } from './inventoryCheckTaskText.ts'

type Translator = (key: string) => string | null | undefined
const label = (t: Translator, key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }

/** The icon-only buttons of a task (hand back, close) and its labelled Pick up: shared by the board row and the task view's bar. The translated name is the tooltip and the accessible name. */
export function TaskActions({ task, t, busy, canWork, onPickup, onRelease, onClose, size = 'row' }: {
  task: Pick<InventoryCheckTask, 'can_pickup' | 'can_release' | 'can_close'>
  t: Translator
  busy: boolean
  canWork: boolean
  onPickup: () => void
  onRelease: () => void
  onClose: () => void
  /** `row`: Pick up carries its word (the counter's main action); `bar`: every action is an icon (Submit stays the labelled one). */
  size?: 'row' | 'bar'
}) {
  const pickup = label(t, 'inventory_check_task_pickup', 'Pick up'), release = label(t, 'inventory_check_task_release', 'Hand back'), close = label(t, 'inventory_check_task_close', 'Close task')
  const icon = 'inline-flex h-11 min-h-11 w-11 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 lg:h-10 lg:min-h-10 lg:w-10 dark:text-gray-300 dark:hover:bg-zinc-800'
  return <span className="inline-flex shrink-0 items-center gap-0.5" data-task-actions>
    {task.can_pickup && canWork ? size === 'row'
      ? <button type="button" data-task-action="pickup" className="btn-primary inline-flex min-h-11 shrink-0 items-center gap-1 px-3 text-xs lg:min-h-10" disabled={busy} onClick={event => { event.stopPropagation(); onPickup() }}><Hand className="h-4 w-4" aria-hidden="true" />{pickup}</button>
      : <button type="button" data-task-action="pickup" className={icon} aria-label={pickup} title={pickup} disabled={busy} onClick={onPickup}><Hand className="h-5 w-5" aria-hidden="true" /></button> : null}
    {task.can_release ? <button type="button" data-task-action="release" className={icon} aria-label={release} title={release} disabled={busy} onClick={event => { event.stopPropagation(); onRelease() }}><Undo2 className="h-5 w-5" aria-hidden="true" /></button> : null}
    {task.can_close ? <button type="button" data-task-action="close" className={icon} aria-label={close} title={close} disabled={busy} onClick={event => { event.stopPropagation(); onClose() }}><Lock className="h-5 w-5" aria-hidden="true" /></button> : null}
  </span>
}

/** The board's header line: the branch (a label, or the Branch menu when there are several) and the labelled Issue button for someone who may issue. */
export function TasksHeader({ t, branches, branchId, onBranch, issue, issueBlocked, onIssue, busy }: {
  t: Translator
  branches: ReadonlyArray<{ id: number; name: string }>
  branchId: string
  onBranch: (id: string) => void
  /** The viewer may issue tasks: the Issue button is drawn. */
  issue: boolean
  /** Why Issue cannot be used right now (the open-task limit), or ''. */
  issueBlocked: string
  onIssue: () => void
  busy: boolean
}) {
  const sole = branches.length === 1 ? branches[0] : null
  const sections: FilterSection[] = [{ id: 'branch', label: label(t, 'branch', 'Branch'), searchable: true, options: branches.map(branch => ({ id: branch.id, label: branch.name, active: branchId === String(branch.id), onClick: () => onBranch(String(branch.id)) })) }]
  const issueText = label(t, 'inventory_check_task_issue', 'Issue')
  return <div className="flex min-w-0 items-center gap-1" data-inventory-check-tasks-header>
    {sole ? <SoleBranchLabel name={sole.name} label={label(t, 'branch', 'Branch')} className="min-w-0 flex-1 text-xs" /> : <>
      {branches.length > 1 ? <FilterMenu label={label(t, 'branch', 'Branch')} activeCount={branchId ? 1 : 0} sections={sections} onClear={() => onBranch('')} iconOnly large /> : null}
      <span className="min-w-0 flex-1 truncate text-xs leading-relaxed" data-tasks-branch>{branches.find(branch => String(branch.id) === branchId)?.name ?? ''}</span>
    </>}
    {issue ? <>
      {issueBlocked ? <InfoHint text={issueBlocked} label={issueBlocked} /> : null}
      <button type="button" data-task-issue className="btn-primary inline-flex min-h-11 shrink-0 items-center gap-1 px-3 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-60 lg:min-h-10" aria-disabled={issueBlocked || busy ? true : undefined} title={issueBlocked || issueText}
        onClick={() => { if (!issueBlocked && !busy) onIssue() }}><ClipboardPlus className="h-4 w-4" aria-hidden="true" />{issueText}</button>
    </> : null}
  </div>
}

export default function InventoryCheckTasksList({ board, t, canWork, busy, onOpen, onPickup, onRelease, onClose }: {
  board: InventoryCheckTasksAnswer
  t: Translator
  canWork: boolean
  busy: boolean
  onOpen: (task: InventoryCheckTask) => void
  onPickup: (task: InventoryCheckTask) => void
  onRelease: (task: InventoryCheckTask) => void
  onClose: (task: InventoryCheckTask) => void
}) {
  if (!board.items.length) {
    return <div className="flex min-w-0 flex-col items-center gap-2 py-6 text-center text-xs text-gray-500" data-inventory-check-empty="tasks">
      <p className="break-words leading-relaxed">{label(t, 'inventory_check_tasks_empty', 'No count tasks.')}</p>
    </div>
  }
  return <ul className="min-w-0 divide-y" aria-label={label(t, 'inventory_check_tasks', 'Tasks')} data-inventory-check-tasks>
    {board.items.map(task => {
      const name = taskName(t, task)
      const progress = progressOrAllText(t, task)
      // Only a Worker that sends the field draws the line; today's sends nothing.
      const reopened = task.reopened
      return <li key={task.id} data-inventory-check-task={task.id} data-task-status={task.status} data-task-mine={task.mine ? '' : undefined} className="min-w-0">
        {/* The whole row opens the task (a tap anywhere). The name is its one real button, so the keyboard and screen readers have a control named by the task; its full text is the tooltip. Pick up, Hand back and Close are separate buttons and never open it. */}
        <div data-task-open className="flex min-h-10 w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 py-2 text-left text-xs xl:flex-nowrap"
          onClick={() => onOpen(task)}>
          <SessionStatusChip status={task.status} t={t} />
          <button type="button" data-task-name title={name} className="flex min-h-11 min-w-0 flex-1 items-center border-0 bg-transparent p-0 text-left text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="block min-w-0 flex-1 truncate font-semibold leading-relaxed">{name}</span></button>
          <span className="ml-auto xl:order-last xl:ml-0 xl:flex xl:w-40 xl:shrink-0 xl:justify-end"><TaskActions task={task} t={t} busy={busy} canWork={canWork} onPickup={() => onPickup(task)} onRelease={() => onRelease(task)} onClose={() => onClose(task)} /></span>
          <div className="flex min-w-0 basis-full flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-relaxed text-gray-600 xl:contents xl:text-xs dark:text-gray-300">
            <span className="inline-flex items-center gap-1 xl:w-36 xl:shrink-0" data-task-progress>
              <ProgressRing figure={false} progress={{ total: task.total, done: task.done, issue: 0, unstarted: Math.max(0, task.total - task.done) }} t={t} />
              <span>{progress}{task.removed > 0 ? ` · ${removedText(t, task.removed)}` : ''}</span>
            </span>
            {task.picked_up_by ? <span data-task-picker className={`min-w-0 xl:w-44 xl:shrink-0 ${task.mine ? 'font-semibold text-emerald-700 dark:text-emerald-300' : ''}`}>{pickerText(t, task.picked_up_by)}</span> : <span aria-hidden="true" className="hidden xl:block xl:w-44 xl:shrink-0" />}
            {task.status === 'closed' && task.closed_at
              ? <span className="text-gray-500 xl:w-40 xl:shrink-0">{label(t, 'shift_status_closed', 'Closed')} <span className="xl:hidden">{fmtDate(task.closed_at)}</span><span className="hidden xl:inline">{fmtDateTime24(task.closed_at)}</span></span>
              : <span className="xl:w-40 xl:shrink-0" data-task-issued><span className="xl:hidden">{fmtDate(task.issued_at)}</span><span className="hidden xl:inline">{fmtDateTime24(task.issued_at)}</span></span>}
            {typeof task.issued_by === 'string' && task.issued_by ? <span className="truncate text-gray-500 xl:w-36 xl:shrink-0" data-task-issuer title={`${label(t, 'inventory_check_created_by', 'Created by')} @${task.issued_by}`}><span className="hidden xl:inline">{label(t, 'inventory_check_created_by', 'Created by')} </span>@{task.issued_by}</span> : null}
          </div>
        </div>
        {reopened ? <p data-task-reopened className="cursor-pointer pb-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300" onClick={() => onOpen(task)}>{reopenedText(t, reopened)}</p> : null}
      </li>
    })}
  </ul>
}

/** The board's one failed-read line: the sentence and a Retry icon. */
export function TasksReadError({ text, retry, onRetry }: { text: string; retry: string; onRetry: () => void }) {
  return <div role="alert" className="flex items-center justify-between gap-2 text-xs leading-relaxed text-red-700">
    <span className="min-w-0 break-words">{text}</span>
    <button type="button" className="inline-flex h-10 min-h-10 w-10 shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-zinc-800" aria-label={retry} title={retry} onClick={onRetry}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
  </div>
}
