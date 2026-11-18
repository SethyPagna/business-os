import { readFileSync } from 'node:fs'
import type { InventoryCheckApproval, InventoryCheckApprovalDecision, InventoryCheckLineAnswer, InventoryCheckSessionItem } from '../src/api/inventoryChecksTransport.ts'

// The answers of the Worker itself in the states the approval panel meets, recorded by the Worker's own test (cloudflare/scripts/test-inventory-check-line-decisions-native.cjs) from the real routes,
// which proves them equal to the live code on every run. The page tests mount from these, never from hand-written approvals: a hand-written approval is what hid the claim the Worker keeps after one
// accepted line. States are GET /api/inventory-checks/sessions/:id; answers are what a decision returned.
//   pending                nobody has decided anything; three lines: 1 and 2 counted by received date, 3 as one total
//   accepted_one           line 1 accepted by this approver: the claim stays (applying, its request id, planned_lines []), the stock of line 1 is the figure it wrote
//   decided_dated          line 1 modified on one of its dates, line 2 rejected, line 3 modified to 4; no claim
//   claimed_by_other       the same decisions, another approver holds the claim and has planned line 3
//   part_written           this approver holds the claim and a Free-plan request wrote one date of line 1 and stopped: planned_lines [1]
//   taken_over             the claim of an approver who is gone, taken over by accepting line 2 (`answer` carries takeover)
//   closed                 line 1 accepted, then Close: the rest are recorded as not applied
//   approved_with_rejected line 2 rejected, the rest approved
//   fully_applied          Approve all: every line applied
//   replaced_line          line 1 accepted, then a newer count replaced line 3
/** `answer` (accepted_one, taken_over): the applied / remaining / done (and takeover) the Worker sent with the approval. */
export type WorkerState = { item: Record<string, unknown>; items: InventoryCheckSessionItem[]; approval: InventoryCheckApproval; answer?: { applied: number; remaining: number; done: boolean; takeover?: true } }
export type WorkerStateName = 'pending' | 'accepted_one' | 'decided_dated' | 'claimed_by_other' | 'part_written' | 'taken_over' | 'closed' | 'approved_with_rejected' | 'fully_applied' | 'replaced_line'
export type WorkerAnswerName = 'accept' | 'accept_resumed' | 'takeover' | 'close' | 'approve_all' | 'modify' | 'reject' | 'reopen'

const file = JSON.parse(readFileSync(new URL('../../cloudflare/scripts/fixtures/inventory-check-approval-states.json', import.meta.url), 'utf8')) as { states: Record<WorkerStateName, WorkerState>; answers: Record<WorkerAnswerName, InventoryCheckApprovalDecision | InventoryCheckLineAnswer> }

export const workerState = (name: WorkerStateName): WorkerState => {
  const state = file.states[name]
  if (!state) throw new Error(`no recorded Worker state ${name}`)
  return structuredClone(state)
}
export const workerAnswer = <T extends InventoryCheckApprovalDecision | InventoryCheckLineAnswer = InventoryCheckApprovalDecision>(name: WorkerAnswerName): T => {
  const answer = file.answers[name]
  if (!answer) throw new Error(`no recorded Worker answer ${name}`)
  return structuredClone(answer) as T
}
