// Pure gating logic for BackgroundImportTracker.tsx's Approve button on a
// Contacts import job (customers/suppliers/delivery_contacts). See
// progress.md's Part 254 backlog item "Contacts import bugs" and its
// Part 313 follow-up: the user's repeated ask was for conflict resolution
// to be part of the natural upload -> review -> import flow, not an
// optional side door a reviewer can miss entirely. Before this, Approve
// and "Resolve conflicts" were two independent, unguarded buttons on the
// same job row -- nothing stopped a reviewer from clicking Approve first
// and never opening the conflicts list at all, even when the job had
// name-match rows genuinely waiting on a decision.
//
// Deliberately a soft nudge, not a hard block: clicking Approve on a job
// with unresolved conflicts the reviewer hasn't opened yet redirects to
// the conflicts modal instead of approving (once per job); clicking
// Approve again afterward proceeds normally, whether or not every row got
// an explicit decision. This matches the existing default-is-safe design
// (classifyContacts already auto-merges an undecided name-match row, see
// ContactImportConflictsModal.tsx's header comment) -- the goal is making
// sure a reviewer SEES the conflicts before committing, not forcing every
// row to be individually resolved before Approve can ever run.

export interface ApproveGateJob {
  type?: unknown
  summary?: { warned?: unknown } | null
}

export const CONTACT_IMPORT_JOB_TYPES = new Set(['customers', 'suppliers', 'delivery_contacts'])

export function shouldPromptProductConflictReviewBeforeApprove(
  job: ApproveGateJob,
  resolvedJobIds: ReadonlySet<string>,
  jobId: string,
): boolean {
  if (String(job.type || '') !== 'products') return false
  if (!(Number(job.summary?.warned || 0) > 0)) return false
  return !resolvedJobIds.has(jobId)
}

// `reviewedJobIds` is the caller's own per-session "conflicts modal has
// been opened for this job at least once" set -- this function doesn't
// own or mutate it, so the same logic can be unit-tested with a plain
// Set literal instead of real component state.
export function shouldPromptConflictReviewBeforeApprove(
  job: ApproveGateJob,
  reviewedJobIds: ReadonlySet<string>,
  jobId: string,
): boolean {
  if (!CONTACT_IMPORT_JOB_TYPES.has(String(job.type || ''))) return false
  const warned = Number(job.summary?.warned || 0)
  if (!(warned > 0)) return false
  return !reviewedJobIds.has(jobId)
}
