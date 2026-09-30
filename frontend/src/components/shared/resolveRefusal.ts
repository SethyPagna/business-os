// Tells a refusal the server answered for certain from an outcome nobody
// knows (owner, 30 Sep 2026: "request not finished" was every refusal dressed
// as an interrupted run). Plain .ts so the adapters that share it load in the
// node unit tests without JSX.
//
// Definite: a 4xx (the request was read and refused before any write), or a
// body that says outcome 'not_applied' (the Worker's rolled-back 409
// merge_failed). Unknown: outcome 'unknown' (http.ts marks every failed
// mutation without an answer that way), a 5xx, a timeout, a dropped
// connection. 408 is a timeout too, so it stays unknown.
export function isDefiniteRefusal(error: unknown): boolean {
  const problem = error as { status?: unknown; outcome?: unknown } | null
  if (!problem || problem.outcome === 'unknown') return false
  if (problem.outcome === 'not_applied') return true
  const status = Number(problem.status)
  return status >= 400 && status < 500 && status !== 408
}
