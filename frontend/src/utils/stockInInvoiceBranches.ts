// The "Received into" branch names of one Stock-in invoice group.
//
// Owner rule: old records are never relabelled. A lot names the branch AS IT WAS when it was received -- the Worker
// sends that label per branch id (`branch_labels`, from product_batches.received_branch_name). The live branch list is
// only the fallback for a lot with no label, so retiring Shop ("Old Shop") and renaming Warehouse ("LC Store") does not
// rewrite what an old invoice says.

export type StockInInvoiceBranchGroup = {
  branch_ids?: string | null
  branch_labels?: Array<{ id: number; name?: string | null }>
}

export function stockInInvoiceBranchNames(
  group: StockInInvoiceBranchGroup,
  liveBranchNameById: ReadonlyMap<string, string>,
): string {
  const labelled = new Map<string, string>()
  for (const label of group.branch_labels || []) {
    const name = String(label?.name || '').trim()
    if (name && !labelled.has(String(label.id))) labelled.set(String(label.id), name)
  }
  const ids = String(group.branch_ids || '').split(',').map((id) => id.trim()).filter(Boolean)
  return ids.map((id) => labelled.get(id) || liveBranchNameById.get(id) || `#${id}`).join(', ')
}
