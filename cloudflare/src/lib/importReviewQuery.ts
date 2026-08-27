import type { ImportWarningKind, RowAction } from './importEngine'

export interface ImportReviewFilter {
  jobId: string
  action?: RowAction | null
  query?: string
  warningKinds?: ImportWarningKind[]
}

export interface ImportReviewWhere {
  sql: string
  params: Record<string, unknown>
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/** Builds only parameterized SQL; user search/warning text never enters SQL. */
export function buildImportReviewWhere(filter: ImportReviewFilter): ImportReviewWhere {
  const clauses = [`job_id = @id`, `phase = 'analyze'`]
  const params: Record<string, unknown> = { id: filter.jobId }
  if (filter.action) {
    clauses.push('action = @action')
    params.action = filter.action
  }
  const query = String(filter.query || '').trim().toLowerCase().slice(0, 160)
  if (query) {
    clauses.push(`LOWER(COALESCE(identifier, '')) LIKE @query ESCAPE '\\'`)
    params.query = `%${escapeLike(query)}%`
  }
  const warningKinds = [...new Set(filter.warningKinds || [])].slice(0, 8)
  if (warningKinds.length) {
    const placeholders = warningKinds.map((kind, index) => {
      const name = `warning${index}`
      params[name] = kind
      return `@${name}`
    })
    clauses.push(`EXISTS (
      SELECT 1 FROM json_each(COALESCE(json_extract(result_json, '$.warnings'), json('[]'))) warning
      WHERE json_extract(warning.value, '$.kind') IN (${placeholders.join(', ')})
    )`)
  }
  return { sql: clauses.join(' AND '), params }
}

