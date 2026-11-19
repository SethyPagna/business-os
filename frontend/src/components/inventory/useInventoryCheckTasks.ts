import { useCallback, useEffect, useRef, useState } from 'react'
import { closeInventoryCheckTask, issueInventoryCheckTask, pickupInventoryCheckTask, readInventoryCheckTasks, releaseInventoryCheckTask, type InventoryCheckTask, type InventoryCheckTaskScope, type InventoryCheckTasksAnswer, type InventoryCheckWriteScope } from '../../api/inventoryChecksTransport.ts'
import { createClientRequestId } from '../../api/requestIds.ts'
import type { ConfirmRequest } from '../shared/useConfirmDialog.tsx'
import { taskRefusalSentence, type TaskReview } from './inventoryCheckTaskText.ts'
import { isSwitchOff404 } from './inventoryWired.ts'

// The last board answer per authority boundary and branch: a later open draws it at once and reads again in the background (changed rows update in place).
const held = new Map<string, InventoryCheckTasksAnswer>()
// The boundary under which the list switch answered 404 (ic_wired off): the tab then shows no Tasks until the authority changes.
let offBoundary: string | null = null
/** Test seam: forget everything this tab held. */
export function resetInventoryCheckTasksMemory() { held.clear(); offBoundary = null }
/** Whether this tab learned that Tasks do not exist (the list switch is off) under this authority. */
export const inventoryCheckTasksOff = (boundary: string) => offBoundary === boundary

export type TaskOutcome<T = unknown> =
  | { kind: 'done'; result: T | null; alreadyMine?: boolean }
  | { kind: 'cancelled' }
  | { kind: 'busy' }
  | { kind: 'refused'; message: string; tone: 'warning' | 'error'; code: string | null }
  | { kind: 'unknown'; message: string }

async function refusalSentence(cause: unknown): Promise<{ key: string; fallback: string } | undefined> {
  const code = (cause as { code?: unknown } | null)?.code
  if (typeof code !== 'string') return undefined
  const { REFUSAL_MESSAGES } = await import('./inventoryCheckRefusals.ts')
  return Object.hasOwn(REFUSAL_MESSAGES, code) ? REFUSAL_MESSAGES[code] : undefined
}

type Args = {
  boundary: string
  branchId: string
  /** The board (or a task view) is on screen: it is read now, and again when the app returns to the foreground. Nothing else reads it, and nothing polls. */
  enabled: boolean
  /** The task a task view shows: a hand back (mine true, then false) is noticed on the board read. */
  taskId: string
  writeScope: InventoryCheckWriteScope
  current: () => boolean
  t: (key: string) => string | null | undefined
  tr: (key: string, fallback: string) => string
  askToConfirm: (request: ConfirmRequest) => Promise<boolean>
  unknownSaveKey: (cause: unknown) => string
  /** False while the device is offline: every write is refused with the page's offline sentence, as every other save on the page is. */
  canWriteToServer: boolean
}
type Attempt = { requestId: string; scope?: InventoryCheckTaskScope }

export function useInventoryCheckTasks(args: Args) {
  const { boundary, branchId, enabled } = args
  const key = `${boundary}:${branchId}`
  for (const existing of [...held.keys()]) if (!existing.startsWith(`${boundary}:`)) held.delete(existing)
  const [board, setBoard] = useState<InventoryCheckTasksAnswer | null>(() => held.get(key) ?? null)
  const [loading, setLoading] = useState(!held.has(key))
  const [failed, setFailed] = useState(false)
  const [off, setOff] = useState(offBoundary === boundary)
  /** The sentence of a 403 the board answered (this account may not work tasks): the held rows are gone and this is shown instead. */
  const [refusal, setRefusal] = useState('')
  const [handedBack, setHandedBack] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const latest = useRef(board)
  latest.current = board
  const inFlight = useRef(false)
  const attempts = useRef(new Map<string, Attempt>())
  const abort = useRef<AbortController | null>(null)
  const live = useRef(true)
  const argsRef = useRef(args)
  argsRef.current = args
  useEffect(() => { live.current = true; return () => { live.current = false; abort.current?.abort() } }, [])

  const refresh = useCallback(async () => {
    if (!branchId || offBoundary === boundary) return
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    try {
      const answer = await readInventoryCheckTasks(branchId, controller.signal)
      if (controller.signal.aborted || !live.current || !argsRef.current.current()) return
      const watched = argsRef.current.taskId
      const before = watched ? latest.current?.items.find(item => item.id === watched) : undefined
      const after = watched ? answer.items.find(item => item.id === watched) : undefined
      if (before?.mine === true && after && after.mine === false && after.status === 'open') setHandedBack(true)
      else if (after?.mine === true) setHandedBack(false)
      held.set(key, answer)
      latest.current = answer
      setBoard(answer); setFailed(false); setRefusal(''); setLoading(false)
    } catch (cause) {
      if (controller.signal.aborted || !live.current || !argsRef.current.current()) return
      const refused = (cause as { status?: unknown; code?: unknown } | null)
      if (isSwitchOff404(cause)) { offBoundary = boundary; setOff(true) }
      else if (refused?.status === 403 && refused.code === 'inventory_check_tasks_required') {
        // This account may not work tasks: rows held from an earlier answer (and their buttons) go, and the refusal's own sentence is shown.
        held.delete(key); latest.current = null; setBoard(null); setFailed(false)
        const mapped = await refusalSentence(cause)
        if (controller.signal.aborted || !live.current || !argsRef.current.current()) return
        setRefusal(argsRef.current.tr(mapped?.key ?? 'inventory_check_error_tasks_required', mapped?.fallback ?? 'You do not have permission to pick up or count tasks.'))
      } else setFailed(true)
      setLoading(false)
    }
  }, [key, branchId, boundary])

  useEffect(() => { if (enabled) void refresh() }, [enabled, refresh])
  useEffect(() => {
    if (!enabled) return
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, refresh])

  // One write at a time. The first send asks the shared review; a repeat after an unknown outcome reuses the frozen request id and asks nothing.
  async function perform<T>(attemptKey: string, review: TaskReview | null, scopeKind: 'ids' | 'filters' | undefined, send: (attempt: Attempt) => Promise<T>, freeze?: () => Partial<Attempt>): Promise<TaskOutcome<T>> {
    if (inFlight.current) return { kind: 'busy' }
    if (!args.canWriteToServer) return { kind: 'refused', code: 'offline', tone: 'error', message: args.tr('inventory_check_count_blocked_offline', 'Saving is unavailable while offline.') }
    let attempt = attempts.current.get(attemptKey)
    if (!attempt) {
      if (review) {
        inFlight.current = true
        const confirmed = await args.askToConfirm(review).finally(() => { inFlight.current = false })
        if (!confirmed || !live.current || !args.current()) return { kind: 'cancelled' }
      }
      attempt = { requestId: createClientRequestId('inventory_check'), ...(freeze ? freeze() : {}) }
      attempts.current.set(attemptKey, attempt)
    }
    inFlight.current = true; setBusy(true); setRetrying(null)
    try {
      const result = await send(attempt)
      attempts.current.delete(attemptKey)
      return { kind: 'done', result }
    } catch (cause) {
      if ((cause as { outcome?: string } | null)?.outcome === 'unknown') {
        setRetrying(attemptKey)
        return { kind: 'unknown', message: args.tr(args.unknownSaveKey(cause), 'Save not confirmed. Retry the same operation or reload.') }
      }
      attempts.current.delete(attemptKey)
      const code = typeof (cause as { code?: unknown } | null)?.code === 'string' ? (cause as { code: string }).code : null
      const figures = taskRefusalSentence(args.t, cause, scopeKind)
      const mapped = figures ? null : await refusalSentence(cause)
      // A pickup that someone else holds is a notice (their name), not an error.
      const named = code === 'inventory_check_task_picked_up' && figures !== null
      const mine = code === 'inventory_check_task_picked_up' && (cause as { mine?: unknown }).mine === true
      return { kind: 'refused', code: mine ? 'mine' : code, tone: named ? 'warning' : 'error', message: figures ?? (mapped ? args.tr(mapped.key, mapped.fallback) : args.tr('inventory_check_save_failed', 'Check not saved. Try again.')) }
    } finally { inFlight.current = false; if (live.current) setBusy(false) }
  }

  /** Issue a task. `scope` is frozen with the request id, so a retry after an unknown outcome sends exactly the same thing. */
  function issue(branch: number, scope: InventoryCheckTaskScope, review: TaskReview) {
    return perform('issue', review, 'productIds' in scope ? 'ids' : 'filters', attempt => issueInventoryCheckTask(args.writeScope, { branchId: branch, requestId: attempt.requestId, scope: attempt.scope ?? scope }), () => ({ scope }))
  }
  async function pickup(task: InventoryCheckTask, review: TaskReview, options: { leaving?: boolean } = {}): Promise<TaskOutcome> {
    const outcome = await perform(`pickup:${task.id}`, review, undefined, attempt => pickupInventoryCheckTask(args.writeScope, task.id, attempt.requestId))
    // A task I already hold is the success this asked for.
    if (outcome.kind === 'refused' && outcome.code === 'mine') { void refresh(); return { kind: 'done', result: null, alreadyMine: true } }
    if (outcome.kind === 'done') setHandedBack(false)
    // A success that leaves for the task view reads nothing here: the view reads the board itself when it opens.
    if ((outcome.kind === 'done' && !options.leaving) || (outcome.kind === 'refused' && outcome.code !== 'offline')) void refresh()
    return outcome
  }
  async function release(task: InventoryCheckTask, review: TaskReview, options: { leaving?: boolean } = {}): Promise<TaskOutcome> {
    const outcome = await perform(`release:${task.id}`, review, undefined, attempt => releaseInventoryCheckTask(args.writeScope, task.id, attempt.requestId))
    if ((outcome.kind === 'done' && !options.leaving) || (outcome.kind === 'refused' && outcome.code !== 'offline')) void refresh()
    return outcome
  }
  async function close(task: InventoryCheckTask, review: TaskReview): Promise<TaskOutcome> {
    const outcome = await perform(`close:${task.id}`, review, undefined, attempt => closeInventoryCheckTask(args.writeScope, task.id, task.revision, attempt.requestId))
    if (outcome.kind === 'done' || (outcome.kind === 'refused' && outcome.code !== 'offline')) void refresh()
    return outcome
  }
  return { board, loading, failed, refusal, off, handedBack, busy, retrying, refresh, issue, pickup, release, close }
}
