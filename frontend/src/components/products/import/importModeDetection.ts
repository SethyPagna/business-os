// Pure signal-detection layer for the "merge the three import paths into
// one" ask (progress.md's Aug 23 backlog, item 10a) -- deliberately built
// first and standalone, same "pure layer before plumbing/UI" order this
// project's own established pattern already used for the Add/Sale import
// (addSaleImportResolve.ts before addSaleImportMapping.ts before
// addSaleImportPlan.ts before any route/UI). Not wired into
// BulkImportModal.tsx yet -- that's the next, larger step (a 3000+ line
// file with a lot of already-shipped, already-tested behavior this change
// must not regress), flagged in progress.md rather than risked blind in
// the same session this was authored.
//
// What this answers: once a file is uploaded into the "Add / Update
// Products" path, does its shape actually look like a dated stock-count
// snapshot (the "Dated Stock Reconciliation" path's real intent) rather
// than a plain one-row-per-product add/update file? The two parse
// semantics are genuinely different (upsert-in-place vs. diff-then-apply
// across dated snapshots of the same product), so this can't be silently
// auto-switched -- but it CAN be detected and surfaced as a suggestion,
// which is the concrete, safe first step toward "one path, not three
// separate up-front choices" without touching either path's own working
// import logic.
//
// Signal used: the same product (by name, case/whitespace-insensitive)
// at the same branch appearing on 2+ distinct non-blank dates within the
// same file. A plain add/update file has at most one row per product+
// branch; a dated-reconciliation file is, by definition, several dated
// snapshots of the same product+branch. Two or more such repeated groups
// is treated as a strong signal (a single accidental duplicate row is
// common and shouldn't trigger a false suggestion; a genuine snapshot
// file will have this pattern across most of its rows).

export interface ImportModeDetectionRow {
  name?: unknown
  branch?: unknown
  date?: unknown
  received_date?: unknown
}

export interface ImportModeDetectionResult {
  likelyDatedReconciliation: boolean
  repeatedGroupCount: number
  sampleProductName: string | null
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// A file can carry either `date` (the dated-reconciliation template's own
// column name) or `received_date` (the Add/Update template's column,
// already aliased to `date` server-side per Part 279's audit) -- checking
// both means this detector works against either template's real header
// set, not just the one it's nominally about.
function rowDate(row: ImportModeDetectionRow): string {
  const raw = row.date ?? row.received_date
  return String(raw ?? '').trim()
}

// Minimum number of distinct product+branch groups that each show 2+
// distinct dates before this is treated as a real signal rather than
// noise (one stray duplicate row, or a file that only has a couple of
// legitimately re-received-on-different-days products, shouldn't flip
// this on for an otherwise ordinary add/update file).
const MIN_REPEATED_GROUPS = 2

export function detectLikelyDatedReconciliation(rows: ImportModeDetectionRow[]): ImportModeDetectionResult {
  const datesByGroup = new Map<string, Set<string>>()
  const originalNameByGroup = new Map<string, string>()

  for (const row of rows || []) {
    const name = normalizeKeyPart(row?.name)
    if (!name) continue
    const date = rowDate(row || {})
    if (!date) continue
    const branch = normalizeKeyPart(row?.branch)
    const groupKey = `${name}::${branch}`
    if (!datesByGroup.has(groupKey)) {
      datesByGroup.set(groupKey, new Set())
      originalNameByGroup.set(groupKey, String(row?.name ?? '').trim())
    }
    datesByGroup.get(groupKey)!.add(date)
  }

  let repeatedGroupCount = 0
  let sampleProductName: string | null = null
  for (const [groupKey, dates] of datesByGroup) {
    if (dates.size >= 2) {
      repeatedGroupCount += 1
      if (!sampleProductName) sampleProductName = originalNameByGroup.get(groupKey) || null
    }
  }

  return {
    likelyDatedReconciliation: repeatedGroupCount >= MIN_REPEATED_GROUPS,
    repeatedGroupCount,
    sampleProductName,
  }
}
