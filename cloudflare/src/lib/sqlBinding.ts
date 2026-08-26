// D1 refuses any statement carrying more than 100 bound parameters.
//
// Measured, not assumed: a live probe against the production `business-os`
// database with 101 `?` placeholders returns
//   `too many SQL variables at offset 227: SQLITE_ERROR`
// and 227 is exactly the character offset of the 101st placeholder. The
// production failure this module exists to stop --
// `GET /api/products -> D1_ERROR: too many SQL variables at offset 415` --
// resolves the same way: offset 415 is the 101st placeholder of
// routes/products.ts's attachBranchStock query, which built one `IN (...)`
// list over every product row on the page.
//
// The trap is that the limit counts BOUND PARAMETERS, not list entries:
//
//   - lib/db.ts's translate() rewrites every `@name` occurrence to its own
//     positional `?`, so a name reused twice in one statement costs two
//     parameters, not one.
//   - Any other placeholder in the same statement (a branch id, a job id,
//     a status) eats into the same budget as the `IN` list.
//
// Both are why `reservedParams` is an explicit argument rather than a
// guessed-at safety margin: a caller states what else its statement binds
// and gets a chunk size that is correct for that statement instead of one
// that happens to work today.
export const D1_MAX_BOUND_PARAMS = 100

/**
 * Splits `items` into slices small enough that one slice plus the
 * statement's other bound parameters stays inside D1's limit.
 *
 * `reservedParams` is the number of parameter *slots* the rest of the
 * statement binds -- count a repeated `@name` once per occurrence.
 * `paramsPerItem` is how many slots each list entry costs (1 for a plain
 * `IN (...)`, more for something like `VALUES (?, ?)` tuples).
 *
 * Returns `[]` for an empty input, so `for (const chunk of ...)` naturally
 * runs zero queries rather than one query with an empty `IN ()`.
 */
export function chunkForBinding<T>(items: readonly T[], reservedParams = 0, paramsPerItem = 1): T[][] {
  if (!items.length) return []
  const budget = D1_MAX_BOUND_PARAMS - Math.max(0, reservedParams)
  const perChunk = Math.floor(budget / Math.max(1, paramsPerItem))
  if (perChunk < 1) {
    // A statement that cannot fit even one list entry is a bug in the
    // caller's SQL, not a runtime condition to paper over: chunking it
    // any further would still fail, just later and less legibly.
    throw new Error(`chunkForBinding: statement reserves ${reservedParams} of ${D1_MAX_BOUND_PARAMS} bound parameters, leaving no room for its IN list`)
  }
  const chunks: T[][] = []
  for (let offset = 0; offset < items.length; offset += perChunk) {
    chunks.push(items.slice(offset, offset + perChunk) as T[])
  }
  return chunks
}

/**
 * Runs `query` once per chunk and concatenates the rows, so a caller reads
 * as one logical `SELECT ... WHERE x IN (<every id>)`.
 *
 * Sequential on purpose: these run inside a Worker request against a
 * single D1 binding, and firing every chunk at once trades the bound-
 * parameter limit for a subrequest/concurrency one.
 */
export async function selectInChunks<TItem, TRow>(
  items: readonly TItem[],
  reservedParams: number,
  query: (chunk: TItem[]) => Promise<TRow[]>,
): Promise<TRow[]> {
  const rows: TRow[] = []
  for (const chunk of chunkForBinding(items, reservedParams)) {
    const chunkRows = await query(chunk)
    if (Array.isArray(chunkRows) && chunkRows.length) rows.push(...chunkRows)
  }
  return rows
}

/**
 * Builds the `IN (...)` body plus the params object for one chunk, for the
 * `@name`-style placeholders this codebase's SQL uses everywhere.
 *
 * `prefix` must be unique within the statement -- two lists in one query
 * (product ids and branch ids, say) need different prefixes or their
 * params collide silently and bind the wrong values.
 */
export function buildInClause(prefix: string, values: readonly unknown[]): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {}
  const sql = values
    .map((value, index) => {
      const name = `${prefix}${index}`
      params[name] = value
      return `@${name}`
    })
    .join(', ')
  return { sql, params }
}

/**
 * Renders an integer id list as SQL literals instead of bound parameters,
 * for the cases where chunking would change the query's meaning -- a
 * paginated `LIMIT/OFFSET` over the list, or a `COUNT(*)` across all of
 * it, neither of which can be split into per-chunk queries and reassembled
 * correctly.
 *
 * Safe against injection because it accepts nothing but safe integers and
 * throws otherwise: there is no string that can reach the SQL text. Use it
 * only for ids the server itself produced (a previous query's rows), never
 * as a way to interpolate user input.
 */
export function inlineIntegerIds(ids: readonly number[]): string {
  return ids
    .map((id) => {
      if (!Number.isSafeInteger(id)) {
        throw new Error(`inlineIntegerIds: refusing to inline a non-integer value (${String(id)})`)
      }
      return String(id)
    })
    .join(', ')
}
