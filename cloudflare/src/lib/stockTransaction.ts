import type { BindParams, D1Compat } from './db'

export const STOCK_SCHEMA_EPOCH = 'legacy-separate-pool-v1'

type StockStatement = { sql: string; params?: BindParams }

const permitSql = `INSERT INTO system_flags (key,value,updated_at)
  VALUES ('stock_transaction_permit', CASE WHEN
    (SELECT value FROM system_flags WHERE key='stock_schema_epoch')='${STOCK_SCHEMA_EPOCH}'
    AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key='maintenance')
    THEN '${STOCK_SCHEMA_EPOCH}'
    ELSE json_extract('[1]','$[stock_schema_unavailable]') END, CURRENT_TIMESTAMP)`

const releaseSql = `DELETE FROM system_flags
  WHERE key='stock_transaction_permit' AND value='${STOCK_SCHEMA_EPOCH}'`

export class StockTransactionUnavailableError extends Error {
  readonly code = 'stock_schema_unavailable'

  constructor() {
    super('Stock recording is unavailable for this application version. Refresh after maintenance finishes.')
    this.name = 'StockTransactionUnavailableError'
  }
}

export class StockTransactionOutcomeUnknownError extends Error {
  readonly code = 'stock_transaction_outcome_unknown'

  constructor() {
    super('The stock transaction result could not be confirmed. Recover its original receipt before retrying.')
    this.name = 'StockTransactionOutcomeUnknownError'
  }
}

export function stockTransactionStatementCount(businessStatements: number): number {
  return businessStatements + 2
}

async function execute<T>(businessCount: number, dispatch: () => Promise<T[]>): Promise<T[]> {
  let results: T[]
  try {
    results = await dispatch()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('$[stock_schema_unavailable]')) throw new StockTransactionUnavailableError()
    throw error
  }
  if (!Array.isArray(results) || results.length !== stockTransactionStatementCount(businessCount)) {
    throw new StockTransactionOutcomeUnknownError()
  }
  return results.slice(1, -1)
}

export function executeStockTransaction(
  db: D1Compat,
  statements: StockStatement[],
  policy: 'once' | 'retry',
): Promise<D1Result[]> {
  const batch = [{ sql: permitSql }, ...statements, { sql: releaseSql }]
  return execute(statements.length, () => policy === 'once' ? db.batchOnce(batch) : db.batch(batch))
}

export function executeRawStockTransaction(
  db: D1Database,
  statements: D1PreparedStatement[],
): Promise<D1Result[]> {
  return execute(statements.length, () => {
    const hook = (globalThis as unknown as Record<symbol, { rawD1Start?(count: number): void } | undefined>)[Symbol.for('business-os.request-metrics.v1')]
    hook?.rawD1Start?.(stockTransactionStatementCount(statements.length))
    return db.batch([db.prepare(permitSql), ...statements, db.prepare(releaseSql)])
  })
}
