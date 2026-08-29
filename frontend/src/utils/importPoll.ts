// Adaptive poll cadence for import-job status.
//
// A fresh or small import finishes its analyze (and apply) phase in well under a
// second, but the screens polled at a fixed 1.2–1.5s interval -- so the
// "Importing…" spinner could sit there for up to a full interval AFTER the work
// was already done, which is exactly the latency the "make it faster" request is
// about. Poll fast for the first few attempts to catch a quick job almost
// immediately, then back off toward the old steady interval so a large/slow
// import doesn't hammer the server. The first poll is still fired immediately by
// the caller; these are the delays BETWEEN subsequent polls.
export const IMPORT_POLL_STEPS_MS: readonly number[] = [300, 400, 600, 900]
export const IMPORT_POLL_STEADY_MS = 1200

// attempt is 0-based: the delay to wait before the (attempt+2)-th poll, i.e.
// importPollDelayMs(0) is the gap after the first poll. Ramps through the fast
// steps then holds at the steady interval.
export function importPollDelayMs(attempt: number): number {
  const index = Math.max(0, Math.floor(Number(attempt) || 0))
  return IMPORT_POLL_STEPS_MS[index] ?? IMPORT_POLL_STEADY_MS
}
