// What a branch-aware surface shows, decided from the branch ROWS and nothing
// else (lane LM, cutover G-M). branchCollapse.ts answers "which branches can
// take something new"; this file answers the three questions every surface
// asks on top of it:
//
//   1. A picker for where something NEW happens (a sale, a receipt, a new
//      product's stock): worth asking only while more than one branch is
//      active. With one active branch the answer is already settled.
//   2. A filter or column over HISTORY: retired branches stay selectable,
//      because old records keep the branch they were made at. It is worth
//      showing while there is anything to tell apart, i.e. more than one row
//      in total, active or not.
//   3. A per-branch comparison (the dashboard card, the Branches report): a
//      comparison of one thing is noise, so it needs two branches' worth of
//      rows, either two active branches or two branches that have data.
//
// None of it reads a name or a flag. Two active branches (today) answer
// "show everything" to all three; one active plus one retired (the morning
// after the cutover) answers "collapse the pickers, keep the history".
import { branchIsActive, type BranchLike } from './branchRoles.ts'
import { hasMultipleActiveBranches } from './branchCollapse.ts'

export type BranchRow = BranchLike & { id: string; name: string }

// The Worker answers GET /api/branches with a bare array; a few callers have
// historically wrapped it as { branches }. Anything without an id is dropped,
// a missing name falls back to the id, and the fields the helpers read
// (is_active, role, successor_branch_id) pass through untouched.
export function normalizeBranchRows(raw: unknown): BranchRow[] {
  const list = Array.isArray(raw) ? raw : (raw !== null && typeof raw === 'object' ? Reflect.get(raw, 'branches') : null)
  if (!Array.isArray(list)) return []
  const rows: BranchRow[] = []
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const id = record.id == null ? '' : String(record.id)
    if (!id) continue
    rows.push({ ...record, id, name: String(record.name || record.branch_name || id) })
  }
  return rows
}

// A history filter is worth showing while two or more branches exist at all.
// `rows === null` means "not loaded yet": callers keep today's behaviour
// instead of flashing a filter in or out.
export function showsBranchHistoryFilter(rows: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(rows) && rows.length > 1
}

// "LC Store" stays "LC Store"; a retired branch reads "Old Shop (Inactive)".
// The caller passes the translated word so this stays a pure function.
export function branchHistoryLabel(branch: BranchLike & { name?: unknown }, inactiveLabel: string): string {
  const name = String(branch.name ?? '')
  return branchIsActive(branch) ? name : `${name} (${inactiveLabel})`
}

// Today's per-branch comparison (two active branches) and any range that
// really contains two branches' sales both keep it. `rows === null` (not
// loaded) keeps it too, so a failed branch read never hides a card.
export function showsBranchComparison(rows: readonly BranchLike[] | null | undefined, dataRowCount: number): boolean {
  if (!Array.isArray(rows)) return true
  return hasMultipleActiveBranches(rows) || dataRowCount > 1
}

// Which per-branch quantity lines of a product are worth printing. Each line
// carries its own branch_active flag (the products and inventory payloads add
// it), so no second list has to be threaded to the screen. With two active
// branches every line is information. With ONE active branch its line only
// repeats the product's own quantity, so it goes; a retired branch that still
// holds stock stays, because it explains why the active line is not the whole
// total. Only a payload whose every line SAYS whether its branch is active is
// judged: lines without the flag (older mirrors, hand-built rows) are shown as
// they always were, because "does not say" is not evidence of one branch.
export function branchStockLinesWorthShowing<T extends { quantity?: unknown; branch_active?: unknown }>(
  lines: readonly T[],
): T[] {
  const isActive = (line: T) => branchIsActive({ is_active: line.branch_active })
  const everyLineSays = lines.length > 0 && lines.every((line) => line.branch_active !== undefined && line.branch_active !== null)
  if (!everyLineSays || lines.filter(isActive).length !== 1) return [...lines]
  return lines.some((line) => !isActive(line) && Number(line.quantity) !== 0) ? [...lines] : []
}

// Marks the choices that are not in the active list and greys them out, so a
// write picker reads "Old Shop (Inactive)" next to "LC Store" but can never
// pick it: a disabled branch is not a new target (owner ruling 6 Oct 2026; a
// change addressed to it goes through the redirect float instead). With no
// active list there is nothing to tell apart, so the choices are left alone.
export function labelInactiveChoices<T extends { value: string | number; label: string }>(
  all: readonly T[],
  active: readonly { value: string | number }[],
  inactiveLabel: string,
): Array<T & { disabled?: boolean }> {
  if (active.length === 0) return [...all]
  const activeValues = new Set(active.map((option) => String(option.value)))
  return all.map((option) => (activeValues.has(String(option.value)) ? option : { ...option, label: `${option.label} (${inactiveLabel})`, disabled: true }))
}

// The till's branch step (and its "Name: qty" summary line) asks only when
// there is something to choose, or something to explain. One branch that can
// sell is already resolved; a lone branch that CANNOT sell keeps the step so
// its notice still reaches the cashier.
export function branchStepMatters(options: readonly { selectable?: boolean }[]): boolean {
  return options.length > 1 || options.some((option) => option.selectable === false)
}

// A picker whose only possible answer is already selected has nothing to ask.
// Strict on purpose: an empty selection, or a selection that is not the one
// choice (a stale draft from the retired branch), is NOT settled, so the
// picker stays and the person can choose. A caller whose form preselects the
// sole branch passes that effective id.
export function branchChoiceSettled(optionIds: readonly (string | number)[], selectedId: unknown): boolean {
  if (optionIds.length !== 1 || selectedId == null || selectedId === '') return false
  return String(selectedId) === String(optionIds[0])
}
