import { Fragment, type ReactNode } from 'react'
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js'
import Modal from '../shared/Modal.tsx'
import PaginationControls from '../shared/PaginationControls.tsx'
import type { InventoryCheckHistoryEvent } from '../../api/inventoryChecksTransport.ts'
import { fmtDateTime24 } from '../../utils/formatters.ts'
import { toolbarIconButtonClassName } from '../shared/toolbarButtonStyles.ts'

type Translator = (key: string) => string | undefined
export type InventoryCheckHistoryResult = { items: InventoryCheckHistoryEvent[]; total: number; page: number; pageSize: number }

const label = (t: Translator, key: string, fallback: string) => { const value = t(key); return value && value !== key ? value : fallback }
// Literal keys (not built from the action code) so the key scanner sees every one of them.
const ACTIONS = {
  create: { key: 'inventory_check_history_action_create', fallback: 'Session created' },
  observe: { key: 'inventory_check_history_action_observe', fallback: 'Checked' },
  close: { key: 'inventory_check_history_action_close', fallback: 'Session closed' },
  resume: { key: 'inventory_check_history_action_resume', fallback: 'Session resumed' },
  other: { key: 'inventory_check_history_action_other', fallback: 'Updated' },
} as const
const STATE_FALLBACKS = { unstarted: 'Not started', done: 'Done', issue: 'Issue' } as const

/** Every server action code and item state reads as a translated phrase; an unknown code degrades to a generic word, never to the raw key. */
export const historyActionLabel = (t: Translator, action: string) => {
  const { key, fallback } = ACTIONS[Object.hasOwn(ACTIONS, action) ? action as keyof typeof ACTIONS : 'other']
  return label(t, key, fallback)
}
export const historyStateLabel = (t: Translator, state: unknown): string | null => {
  if (typeof state !== 'string' || !Object.hasOwn(STATE_FALLBACKS, state)) return null
  return label(t, `inventory_check_${state}`, STATE_FALLBACKS[state as keyof typeof STATE_FALLBACKS])
}

function HistoryRow({ event, t }: { event: InventoryCheckHistoryEvent; t: Translator }) {
  const before = historyStateLabel(t, event.before?.state), after = historyStateLabel(t, event.after?.state)
  const reason = typeof event.after?.reason === 'string' && event.after.reason ? event.after.reason : null
  // dd/mm/yyyy HH:mm · @user · product · Not started → Issue · reason. A session-level event (create/close/resume) names the action instead of a state change.
  const change = event.product_id === null || !after
    ? historyActionLabel(t, event.action)
    : <span>{before ? <>{before}{' '}<span aria-hidden="true">→</span>{' '}</> : null}<strong>{after}</strong></span>
  const parts: ReactNode[] = [fmtDateTime24(event.created_at)]
  if (event.actor_name) parts.push(`@${event.actor_name}`)
  if (event.product_name) parts.push(<strong key="product">{event.product_name}</strong>)
  parts.push(change)
  if (reason) parts.push(<span key="reason" className="text-amber-800 dark:text-amber-200">{reason}</span>)
  return <li data-inventory-check-history={event.id} className="min-w-0 break-words py-2 text-xs">
    {parts.map((part, index) => <Fragment key={index}>{index > 0 ? ' · ' : null}{part}</Fragment>)}
  </li>
}

/** A float that opens with its rows' shape on screen: skeleton lines until the first page arrives, the load error with Retry beside it. */
export default function InventoryCheckHistoryFloat({ page, history, error, onPage, onRetry, onClose, t }: {
  page: number
  history: InventoryCheckHistoryResult | null
  error: string
  onPage: (page: number) => void
  onRetry: () => void
  onClose: () => void
  t: Translator
}) {
  return <Modal title={label(t, 'history', 'History')} onClose={onClose} keyboard size="sm" unsavedChanges="read-only">
    {error ? <div role="alert" className="flex items-center justify-between gap-2 text-xs text-red-700">
      <span className="min-w-0 break-words">{error}</span>
      <button type="button" className={toolbarIconButtonClassName} aria-label={label(t, 'retry', 'Retry')} title={label(t, 'retry', 'Retry')} onClick={onRetry}><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
    </div> : !history
      ? <ul className="divide-y" aria-busy="true" data-inventory-check-history-skeleton>
        <li className="sr-only" role="status">{label(t, 'loading', 'Loading...')}</li>
        {[0, 1, 2, 3].map(row => <li key={row} className="py-3" aria-hidden="true"><div className="h-3 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-zinc-700" /></li>)}
      </ul>
      : history.items.length
        ? <ul className="divide-y">{history.items.map(event => <HistoryRow key={event.id} event={event} t={t} />)}</ul>
        : <p className="py-3 text-xs text-gray-500">{label(t, 'inventory_check_history_empty', 'No history yet.')}</p>}
    {history?.page === page ? <PaginationControls page={page} pageSize={20} totalItems={history.total} onPageChange={onPage} t={t} compact /> : null}
  </Modal>
}
