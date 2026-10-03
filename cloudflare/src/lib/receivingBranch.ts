import type { D1Compat } from './db'

export const RECEIVING_BRANCH_INACTIVE = {
  error: 'Choose an active branch before receiving stock. Refresh the branch list and try again.',
  code: 'receiving_branch_inactive',
} as const

export class ReceivingBranchError extends Error {
  constructor() {
    super(RECEIVING_BRANCH_INACTIVE.error)
    this.name = 'ReceivingBranchError'
  }
}

export async function requireReceivingBranch(db: D1Compat, branchId: number): Promise<void> {
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw new ReceivingBranchError()
  const branch = await db.prepare('SELECT id FROM branches WHERE id=@branchId AND is_active=1').get({ branchId })
  if (!branch) throw new ReceivingBranchError()
}

export function receivingBranchAssertion(branchId: number) {
  if (!Number.isSafeInteger(branchId) || branchId <= 0) throw new ReceivingBranchError()
  return {
    sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM branches WHERE id=@receivingBranchId AND is_active=1)
      THEN 1 ELSE json_extract('[1]', '$[receiving_branch_inactive]') END AS receiving_branch_guard`,
    params: { receivingBranchId: branchId },
  }
}

export function isReceivingBranchError(error: unknown): boolean {
  return error instanceof ReceivingBranchError
    || /bad JSON path: ['"]\$\[receiving_branch_inactive\]['"]/i.test(error instanceof Error ? error.message : String(error))
}
