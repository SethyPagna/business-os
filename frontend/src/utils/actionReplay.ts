// The K1 double-apply guard, kept in its own dependency-free module so it is
// unit-testable in the plain-node test harness without importing the React
// hook (utils/actionHistory.ts) and its transitive, extensionless imports.
//
// When the Worker replayed the reversal itself (serverApplied -- the /undo|/redo
// response was applied:true), the mutating closure must NOT run again; the
// refresh-only callback runs instead to re-pull the page. Absent a refresh
// callback, or when the server did not apply, the original closure runs, which
// is the behavior that predates server appliers.
export function resolveReplayAction<T>(opts: {
  serverApplied: boolean
  refresh?: (() => T | Promise<T>) | undefined
  action?: (() => T | Promise<T>) | undefined
}): (() => T | Promise<T>) | undefined {
  if (opts.serverApplied && typeof opts.refresh === 'function') return opts.refresh
  return opts.action
}
