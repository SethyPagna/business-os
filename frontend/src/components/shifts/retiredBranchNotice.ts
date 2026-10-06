import type { ShiftState } from '../../api/shiftTransport.ts'

/**
 * N7: what the till shows when GET /current says its branch no longer trades.
 *
 * Before, /current refused a retired branch with a 400 the POS swallowed, so a
 * long-lived till tab after the cutover showed no shift prompt, no End Shift
 * and no reason. Now the server answers `branch_inactive`, and this decides
 * the one notice the gate renders -- never silence:
 *
 *   * 'open_shift' -- the cashier's own drawer is still open there. The notice
 *     says to end it first and can be set aside, so End Shift in the header is
 *     reachable; once the shift is closed the state changes and the notice
 *     comes back as one of the two below.
 *   * 'switch'     -- an active successor exists and the till can switch to it.
 *   * 'reload'     -- no successor (or no way to switch): reload to pick one.
 *
 * `key` identifies what was set aside, so a different drawer or branch brings
 * the notice back.
 */
export type RetiredBranchNotice = {
  key: string
  mode: 'open_shift' | 'switch' | 'reload'
  branch: string
  successor: string | null
  successorId: number | null
}

export function retiredBranchNotice(
  state: Pick<ShiftState, 'branch_inactive' | 'is_open' | 'shift'> | null | undefined,
  options: { canSwitch: boolean; dismissedKey?: string | null },
): RetiredBranchNotice | null {
  const retired = state?.branch_inactive
  if (!retired) return null
  const openThere = state?.is_open === true && !!state.shift
  const key = `${retired.branch_id}:${openThere ? state?.shift?.id : 'none'}`
  if (openThere && options.dismissedKey === key) return null
  const successorId = retired.successor_branch_id ?? null
  const successor = retired.successor_branch_name ?? null
  const mode = openThere ? 'open_shift' : successorId != null && successor && options.canSwitch ? 'switch' : 'reload'
  return { key, mode, branch: retired.branch_name, successor, successorId }
}
