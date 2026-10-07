// The stock writers whose branch the REQUEST names (adjust, receive, move-row, stock sessions, tagged rows,
// product create) or a stored row names (Revert, stock-in line edit): after the branch cutover a write
// addressed to a disabled branch is refused with branch_redirect_required until the operator confirms an
// active branch (X-Branch-Redirect, lib/branchEffect.ts), and then lands there with the disabled branch kept as
// inventory_movements.addressed_branch_name (owner ruling 6 Oct 2026, CUTOVER-LR).
//
// While every branch is active nothing here adds a statement, a parameter or a column: an active (or unknown)
// branch resolves to itself and every helper below returns its input unchanged.
import type { BindParams, D1Compat } from './db'
import {
  BRANCH_REDIRECT_TARGET_INVALID_CODE, BRANCH_REDIRECT_TARGET_INVALID_ERROR,
  branchEffectGuardPredicate, branchEffectRefusal, branchRedirectDetail, foldedLotSurvivors, readBranchDirectory, resolveBranchEffect,
  type BranchEffect, type BranchEffectRow, type BranchRedirectDetail,
} from './branchEffect'

// The one import of the stock writers: the request side of the contract and the Undo refusal, restated here.
export { BRANCH_REDIRECT_TARGET_INVALID_CODE, BRANCH_REDIRECT_TARGET_INVALID_ERROR, branchEffectRefusal, branchRedirectTarget, readBranchDirectory, type BranchEffect } from './branchEffect'
export { UNDO_CLOSED_BRANCH_RETIRED_CODE, UNDO_CLOSED_BRANCH_RETIRED_MESSAGE } from './branchCutoverHistory'

type Statement = { sql: string; params?: BindParams }

// The confirmed redirect branch (X-Branch-Redirect), or a reader of it: a reader is only called for a branch that
// is disabled, so while every branch is active the request header is never read.
export type RedirectTarget = number | null | (() => number | null)
const targetOf = (target: RedirectTarget): number | null => typeof target === 'function' ? target() : target

/** requestBranchEffect over a directory already read (one read for many branch ids). */
export function directoryBranchEffect(directory: readonly BranchEffectRow[], branchId: number, target: RedirectTarget): BranchEffect {
  const addressed = directory.find((row) => Number(row.id) === Number(branchId))
  const disabled = !!addressed && Number(addressed.is_active ?? 1) !== 1
  return resolveBranchEffect(directory, branchId, { target: disabled ? targetOf(target) : null })
}

/**
 * Where a stock write addressed to `branchId` lands: the branch itself while it is active (or unknown to the
 * directory, so the caller's own "branch not found" refusal still answers), else the confirmed `target`.
 * Throws the branchEffect refusals (redirect required, target invalid, no active branch at all).
 */
export async function requestBranchEffect(db: D1Compat, branchId: number, target: RedirectTarget): Promise<BranchEffect> {
  return directoryBranchEffect(await readBranchDirectory(db), branchId, target)
}

/**
 * requestBranchEffect plus the landing branch's id and name from the same directory read: the writers that used
 * to read `SELECT id, name FROM branches WHERE id = <branch>` take it from here instead, so the redirect costs
 * them no extra D1 query (the stock-in commit's per-line budget, test-stock-in-commit-d1-budget-pure.cjs).
 * `branch` is null for an id the directory does not hold, as that read was.
 */
export async function requestBranchLanding(db: D1Compat, branchId: number, target: RedirectTarget): Promise<{ landing: BranchEffect; branch: { id: number; name: string } | null }> {
  const directory = await readBranchDirectory(db)
  const landing = directoryBranchEffect(directory, branchId, target)
  const row = directory.find((entry) => Number(entry.id) === Number(landing.effectBranchId))
  return { landing, branch: row ? { id: Number(row.id), name: row.name as string } : null }
}

/**
 * The lot a redirected write names, as it exists at the landing branch: the consolidation folded same-day lots
 * into one survivor there, and writing the folded id would re-create the split. Anything that is not a lot id
 * (absent, 'new') and every write that was not redirected is returned unchanged.
 */
export async function landingLotId<T>(db: D1Compat, effect: BranchEffect, batchId: T): Promise<T | number> {
  const id = Number(batchId)
  if (!effect.redirected || !Number.isSafeInteger(id) || id <= 0 || String(batchId).trim() !== String(id)) return batchId
  return (await foldedLotSurvivors(db, effect.effectBranchId, [id])).get(id) ?? batchId
}

const GUARD_PATH = '$[branch_redirect_target_invalid]'

/**
 * In-batch re-proof of a redirect: the landing branch is still active with no successor and the addressed
 * branch is still disabled. Otherwise the whole batch aborts (a bad JSON path, the receivingBranch idiom).
 */
export function branchRedirectGuard(effect: BranchEffect): Statement {
  return {
    sql: `SELECT CASE WHEN (${branchEffectGuardPredicate('@branchRedirectGuard')}) THEN 1 ELSE json_extract('[1]','${GUARD_PATH}') END AS branch_redirect_guard`,
    params: { branchRedirectGuard: JSON.stringify([{ addressed: effect.addressedBranchId, effect: effect.effectBranchId, sells: 0 }]) },
  }
}

export function isBranchRedirectGuardError(error: unknown): boolean {
  return /bad JSON path: ['"]\$\[branch_redirect_target_invalid\]['"]/i.test(error instanceof Error ? error.message : String(error))
}

/** The 409 body after the in-batch guard aborted: the refusal the branch directory gives now. */
export async function branchRedirectGuardRefusal(db: D1Compat, addressedBranchId: number, redirectTarget: RedirectTarget): Promise<{ error: string; code: string; redirect?: BranchRedirectDetail }> {
  const directory = await readBranchDirectory(db)
  const target = targetOf(redirectTarget)
  try {
    resolveBranchEffect(directory, addressedBranchId, { target })
  } catch (error) {
    const refusal = branchEffectRefusal(error)
    if (refusal) return refusal
    throw error
  }
  const redirect = branchRedirectDetail(directory, addressedBranchId, { requestedTargetId: target })
  return { error: BRANCH_REDIRECT_TARGET_INVALID_ERROR, code: BRANCH_REDIRECT_TARGET_INVALID_CODE, ...(redirect ? { redirect } : {}) }
}

const MOVEMENT_INSERT = /^(\s*INSERT\s+INTO\s+inventory_movements\s*\()([^()]*)(\)\s*(?:VALUES\s*\(|SELECT\s))/i

/**
 * One inventory_movements INSERT that also records the branch the write was addressed to. The column and its
 * value lead the column list and the VALUES/SELECT list; a movement INSERT of any other shape throws, so no
 * redirected movement can be written without its label. Any other statement is returned unchanged.
 */
export function addressedMovement<T extends Statement>(statement: T, addressedName: string | null): T {
  if (!/^\s*INSERT\s+INTO\s+inventory_movements\b/i.test(statement.sql)) return statement
  const match = MOVEMENT_INSERT.exec(statement.sql)
  if (!match || /\baddressed_branch_name\b/i.test(match[2]) || Array.isArray(statement.params)) {
    throw new Error('A redirected stock movement must name the branch it was addressed to')
  }
  return {
    ...statement,
    sql: statement.sql.replace(MOVEMENT_INSERT, '$1addressed_branch_name, $2$3@addressedBranchName, '),
    params: { ...(statement.params || {}), addressedBranchName: addressedName },
  }
}

/**
 * A write batch for one landing: unchanged when nothing was redirected; otherwise the in-batch guard first and
 * every movement it writes labelled with the addressed branch.
 */
export function addressedStatements<T extends Statement>(effect: BranchEffect | null | undefined, statements: T[]): Statement[] {
  if (!effect?.redirected) return statements
  return [branchRedirectGuard(effect), ...statements.map((statement) => addressedMovement(statement, effect.addressedName))]
}
