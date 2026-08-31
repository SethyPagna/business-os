// Final, cross-window conflict seal for §12 stock-action analysis.
// Per-window classification cannot see an identity whose rows straddle two
// queue invocations. This one D1 statement groups persisted results across
// the complete job and appends the same stable warning used by the pure
// resolver, without loading/JSON.parsing the whole import in Worker memory.

import type { D1Compat } from './db'
import { COST_BATCH_CONFLICT_MESSAGE } from './stockActionResolver'

export async function sealUnifiedStockAnalyzeConflicts(db: D1Compat, jobId: string): Promise<number> {
  const result = await db.staging.prepare(`
    WITH conflict_identities AS (
      SELECT json_extract(result_json, '$.data.identityKey') AS identity_key
      FROM import_job_rows
      WHERE job_id = @jobId
        AND phase = 'analyze'
        AND json_extract(result_json, '$.data.identityKey') IS NOT NULL
      GROUP BY identity_key
      HAVING COUNT(DISTINCT CASE
               WHEN COALESCE(CAST(json_extract(result_json, '$.data.costPriceUsd') AS REAL), 0) != 0
               THEN ROUND(CAST(json_extract(result_json, '$.data.costPriceUsd') AS REAL), 3)
             END) > 1
         AND COUNT(DISTINCT CASE
               WHEN TRIM(COALESCE(json_extract(result_json, '$.data.batchLabel'), '')) != ''
               THEN TRIM(json_extract(result_json, '$.data.batchLabel'))
             END) > 1
    )
    UPDATE import_job_rows
    SET result_json = json_set(
      result_json,
      '$.message', CASE
        WHEN COALESCE(json_extract(result_json, '$.message'), '') = '' THEN @reason
        WHEN INSTR(json_extract(result_json, '$.message'), @reason) > 0 THEN json_extract(result_json, '$.message')
        ELSE json_extract(result_json, '$.message') || ' ' || @reason
      END,
      '$.data.conflicts', json_insert(
        COALESCE(json_extract(result_json, '$.data.conflicts'), json('[]')),
        '$[#]', @reason
      ),
      '$.warnings', json_insert(
        COALESCE(json_extract(result_json, '$.warnings'), json('[]')),
        '$[#]', json_object('kind', 'stock_action_conflict', 'message', @reason)
      )
    )
    WHERE job_id = @jobId
      AND phase = 'analyze'
      AND json_extract(result_json, '$.data.identityKey') IN (SELECT identity_key FROM conflict_identities)
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(COALESCE(json_extract(result_json, '$.warnings'), json('[]'))) warning
        WHERE json_extract(warning.value, '$.message') = @reason
      )
  `).run({ jobId, reason: COST_BATCH_CONFLICT_MESSAGE })
  return Number(result.changes || 0)
}

export async function countUnifiedStockConfirmationRows(db: D1Compat, jobId: string): Promise<number> {
  const row = await db.staging.prepare(`
    SELECT COUNT(DISTINCT rows.row_number) AS n
    FROM import_job_rows rows,
         json_each(COALESCE(json_extract(rows.result_json, '$.warnings'), json('[]'))) warning
    WHERE rows.job_id = @jobId
      AND rows.phase = 'analyze'
      AND json_extract(warning.value, '$.kind') = 'stock_action_conflict'
  `).get<{ n: number }>({ jobId })
  return Number(row?.n || 0)
}
