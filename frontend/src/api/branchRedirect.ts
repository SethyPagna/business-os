// The disabled-branch redirect (CUTOVER-LR, owner ruling 6 Oct 2026).
//
// A change addressed to a disabled branch (an old Shop sale, return, expense or Stock Changes row after the branch
// consolidation) is refused by the Worker with 409 `branch_redirect_required`, carrying the disabled branch, its
// successor and every active branch the change may go to (cloudflare/src/lib/branchEffect.ts). api/http.ts hands that
// refusal to the one registered host (components/shared/BranchRedirectHost.tsx), which asks the operator: the float
// "<branch> is disabled. Redirect to <successor>?" with a picker and Back / Redirect, then the shared confirm dialog.
// A confirmed branch is sent back on the SAME request in the X-Branch-Redirect header, so every writer in the app gets
// the same flow without wiring of its own. Before the cutover the Worker never sends this code and nothing here runs.

import { branchIsActive, branchRole, type BranchLike } from '../utils/branchRoles.ts'

export const BRANCH_REDIRECT_HEADER = 'X-Branch-Redirect'
export const BRANCH_REDIRECT_REQUIRED_CODE = 'branch_redirect_required'
export const BRANCH_REDIRECT_TARGET_INVALID_CODE = 'branch_redirect_target_invalid'
export const BRANCH_REDIRECT_DECLINED_CODE = 'branch_redirect_declined'

export type BranchRedirectOption = { id: number; name: string | null }
export type BranchRedirectDetail = {
  addressed_branch_id: number
  addressed_branch_name: string | null
  successor_branch_id: number | null
  successor_branch_name: string | null
  targets: BranchRedirectOption[]
  requested_target_id: number | null
}
export type BranchRedirectRequest = { code: string; detail: BranchRedirectDetail }
/** Resolves the branch id the operator confirmed, or null for Back. */
export type BranchRedirectHandler = (request: BranchRedirectRequest) => Promise<number | null>

let handler: BranchRedirectHandler | null = null
let queue: Promise<unknown> = Promise.resolve()

/** The host registers itself; the returned function unregisters it (only if it is still the registered one). */
export function registerBranchRedirectHandler(next: BranchRedirectHandler): () => void {
  handler = next
  return () => { if (handler === next) handler = null }
}

export function hasBranchRedirectHandler(): boolean {
  return handler !== null
}

function positiveId(value: unknown): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** The redirect a refused response carries, or null when it is not a redirect refusal the operator can answer. */
export function branchRedirectRequestOf(error: unknown): BranchRedirectRequest | null {
  if (!error || typeof error !== 'object') return null
  const code = String((error as { code?: unknown }).code || '')
  if (code !== BRANCH_REDIRECT_REQUIRED_CODE && code !== BRANCH_REDIRECT_TARGET_INVALID_CODE) return null
  const raw = (error as { redirect?: unknown }).redirect
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const addressed = positiveId(source.addressed_branch_id)
  const targets = (Array.isArray(source.targets) ? source.targets : [])
    .map((row) => (row && typeof row === 'object' ? { id: positiveId((row as Record<string, unknown>).id), name: (row as Record<string, unknown>).name } : null))
    .filter((row): row is { id: number; name: unknown } => !!row && row.id !== null)
    .map((row) => ({ id: row.id, name: typeof row.name === 'string' ? row.name : null }))
  if (addressed === null || targets.length === 0) return null
  return {
    code,
    detail: {
      addressed_branch_id: addressed,
      addressed_branch_name: typeof source.addressed_branch_name === 'string' ? source.addressed_branch_name : null,
      successor_branch_id: positiveId(source.successor_branch_id),
      successor_branch_name: typeof source.successor_branch_name === 'string' ? source.successor_branch_name : null,
      targets,
      requested_target_id: positiveId(source.requested_target_id),
    },
  }
}

type DirectoryRow = BranchLike & { id: unknown; name?: unknown }

/**
 * The same question built from the branch directory the page already holds, for a flow that must ask BEFORE it can
 * show anything (adding items to an old Shop sale needs the shelf it will sell from). Twin of the Worker's
 * branchRedirectDetail: valid targets are active, carry no successor, and sell when `sells`; the successor leads.
 * Null when the branch is active (nothing to ask) or no active branch could take the change.
 */
export function clientBranchRedirectDetail(rows: readonly DirectoryRow[], addressedBranchId: unknown, options: { sells?: boolean } = {}): BranchRedirectDetail | null {
  const addressedId = positiveId(addressedBranchId)
  const addressed = addressedId === null ? undefined : rows.find((row) => positiveId(row.id) === addressedId)
  if (!addressed || branchIsActive(addressed)) return null
  const targets = rows.filter((row) => positiveId(row.id) !== null && branchIsActive(row) && row.successor_branch_id == null
    && (!options.sells || branchRole(row) === 'shop'))
  if (!targets.length) return null
  const successorId = positiveId(addressed.successor_branch_id)
  const name = (row: DirectoryRow): string | null => (typeof row.name === 'string' && row.name ? row.name : null)
  const ordered = [...targets].sort((a, b) => (positiveId(b.id) === successorId ? 1 : 0) - (positiveId(a.id) === successorId ? 1 : 0)
    || String(name(a) ?? '').localeCompare(String(name(b) ?? '')) || Number(a.id) - Number(b.id))
  const successor = successorId === null ? undefined : ordered.find((row) => positiveId(row.id) === successorId)
  return {
    addressed_branch_id: addressedId!,
    addressed_branch_name: name(addressed),
    successor_branch_id: successor ? successorId : null,
    successor_branch_name: successor ? name(successor) : null,
    targets: ordered.map((row) => ({ id: positiveId(row.id)!, name: name(row) })),
    requested_target_id: null,
  }
}

/** The branch a new ask starts on: the successor when it is a valid target, else the first target. */
export function defaultRedirectTarget(detail: BranchRedirectDetail): number {
  const successor = detail.successor_branch_id
  return successor !== null && detail.targets.some((row) => row.id === successor) ? successor : detail.targets[0].id
}

/**
 * Asks the registered host where a refused change should go. One question at a time: a second refusal (another tab of
 * the same page, a grouped action) waits for the first answer. Null when there is no host or the operator went Back.
 */
export function askBranchRedirect(request: BranchRedirectRequest): Promise<number | null> {
  const current = handler
  if (!current) return Promise.resolve(null)
  const answer = queue.then(() => current(request))
  queue = answer.catch(() => null)
  return answer.then((value) => (value !== null && request.detail.targets.some((row) => row.id === value) ? value : null))
}
