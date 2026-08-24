// Pure decision logic for what ContactImportModal.tsx shows *after* it
// calls startImportJob(), while the server analyzes the file in the
// background. See progress.md's Part 313 item 5 / Part 254 backlog:
// the user's repeated ask was "same upload -> review -> (duplicate
// resolution inside review) flow Products already has", specifically
// "simpler" than today. Before this, the modal fired startImportJob and
// immediately closed with a toast ("...Review and approve it from the
// top progress bar."), leaving conflict resolution as a second, easy-to-
// miss stop in BackgroundImportTracker's floating widget -- exactly the
// "so many problems in import widget" complaint. This function is the
// single source of truth for "given the latest polled job snapshot, what
// should the modal do next", kept separate from the component so it's
// testable with plain job objects instead of timers/DOM.
//
// Deliberately does NOT duplicate BackgroundImportTracker's own list-
// polling/backoff logic (ACTIVE_STATUSES/REVIEW_STATUSES, retry-with-
// backoff, dismissal memory) -- that component remains the single owner
// of "what jobs exist and their overall status" for the whole app. This
// is a much narrower one-job foreground poll, scoped to the single job
// this modal itself just created, for exactly as long as the modal stays
// open. If the operator closes the modal early, BackgroundImportTracker
// picks the same job up exactly as it already did before this change --
// nothing about that path is removed or altered.

export type ContactImportPostStartJob = {
  status?: unknown
  summary?: { warned?: unknown } | null
}

export type ContactImportPostStartAction =
  | { kind: 'keep_polling' }
  | { kind: 'show_conflicts' }
  | { kind: 'ready_to_approve' }
  | { kind: 'terminal' }

// Same vocabulary as BackgroundImportTracker's ACTIVE_STATUSES/
// REVIEW_STATUSES (normalizeJobStatus) -- not re-exported from there to
// avoid coupling this file to that component's internals; these are the
// server's own job.status values (routes/importJobs.ts), a stable
// contract both files already depend on independently.
const STILL_ANALYZING_STATUSES = new Set(['pending', 'queued', 'analyzing'])
const TERMINAL_STATUSES = new Set(['failed', 'cancelled'])

export function decideContactImportPostStartAction(
  job: ContactImportPostStartJob | null | undefined,
): ContactImportPostStartAction {
  const status = String(job?.status || '').trim().toLowerCase()
  if (!status || STILL_ANALYZING_STATUSES.has(status)) return { kind: 'keep_polling' }
  if (TERMINAL_STATUSES.has(status)) return { kind: 'terminal' }
  if (status !== 'awaiting_review') return { kind: 'keep_polling' }
  const warned = Number(job?.summary?.warned || 0)
  return warned > 0 ? { kind: 'show_conflicts' } : { kind: 'ready_to_approve' }
}
