// The branch rows (active AND retired) for a surface that does not already
// hold them, so it can ask branchScope.ts what to show. One shared request
// serves every surface mounted close together (the dashboard cards, the
// report filters); the answer is dropped after BRANCH_ROWS_TTL_MS so a branch
// change on another device is picked up on the next mount without a reload.
//
// `rows` is null until the first answer, and stays null if the read fails:
// every caller treats null as "keep today's behaviour", so a failed read can
// never hide a control the person needs.
import { useEffect, useState } from 'react'
import { normalizeBranchRows, type BranchRow } from './branchScope.ts'

export const BRANCH_ROWS_TTL_MS = 30_000

let cached: { at: number; promise: Promise<BranchRow[]> } | null = null

export function loadBranchRows(now: number = Date.now()): Promise<BranchRow[]> {
  if (cached && now - cached.at < BRANCH_ROWS_TTL_MS) return cached.promise
  const promise = import('../api/branchTransport.ts')
    .then((mod) => mod.getBranches())
    .then(normalizeBranchRows)
  const entry = { at: now, promise }
  cached = entry
  // A failed read must not be served for the next 30 seconds.
  promise.catch(() => { if (cached === entry) cached = null })
  return promise
}

export function useBranchRows(): BranchRow[] | null {
  const [rows, setRows] = useState<BranchRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    loadBranchRows().then((next) => { if (!cancelled) setRows(next) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  return rows
}
