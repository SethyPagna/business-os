import { readFileSync } from 'node:fs'
import type { InventoryCheckApproval, InventoryCheckSessionItem } from '../src/api/inventoryChecksTransport.ts'

// The answers of the Worker itself (GET /api/inventory-checks/sessions/:id) in the states the approval panel meets, recorded by the Worker's own test
// (cloudflare/scripts/test-inventory-check-line-decisions-native.cjs), which proves them equal to the live code on every run. The page tests mount from these,
// never from hand-written approvals: a hand-written approval is what hid the claim the Worker keeps after one accepted line.
//   pending           nobody has decided anything; three lines: 1 and 2 counted by received date, 3 as one total
//   accepted_one      line 1 accepted by this approver: the claim stays (applying, its request id, planned_lines []), the stock of line 1 is the figure it wrote
//   decided_dated     line 1 modified on one of its dates, line 2 rejected, line 3 modified to 4; no claim
//   claimed_by_other  the same decisions, another approver holds the claim and has planned line 3
/** `answer` (accepted_one only): the applied / remaining / done the Worker sent with the approval when it accepted line 1. */
export type WorkerState = { item: Record<string, unknown>; items: InventoryCheckSessionItem[]; approval: InventoryCheckApproval; answer?: { applied: number; remaining: number; done: boolean } }
export type WorkerStateName = 'pending' | 'accepted_one' | 'decided_dated' | 'claimed_by_other'

const file = JSON.parse(readFileSync(new URL('../../cloudflare/scripts/fixtures/inventory-check-approval-states.json', import.meta.url), 'utf8')) as { states: Record<WorkerStateName, WorkerState> }

export const workerState = (name: WorkerStateName): WorkerState => {
  const state = file.states[name]
  if (!state) throw new Error(`no recorded Worker state ${name}`)
  return structuredClone(state)
}
