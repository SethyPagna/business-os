import { __reportScalarForNative as oldUpper } from 'scalar:old'
import { __reportScalarForNative as candidateUpper } from 'scalar:candidate'

const expressions = ['p.v', '(p."v")', 'COALESCE(p.v,NULL)']
const encoder = new TextEncoder()
const errorValue = (error: unknown) => ({ name: error instanceof Error ? error.name : typeof error, message: error instanceof Error ? error.message : String(error) })
function binaryHex(value: unknown): string | null {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
    : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : Array.isArray(value) && value.every(item => Number.isInteger(item) && item >= 0 && item <= 255) ? new Uint8Array(value) : null
  return bytes ? [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') : null
}
function replaceOne(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error('Non-unique wrong-bound seam: ' + before)
  return source.replace(before, after)
}
function replaceTextBranch(source: string, expression: string): string {
  const marker = "WHEN 'text' THEN ", end = " WHEN 'blob' THEN"
  const begin = source.indexOf(marker), finish = source.indexOf(end, begin)
  if (begin < 0 || finish < begin || source.split(marker).length !== 2) throw new Error('Non-unique text-branch seam')
  return source.slice(0, begin + marker.length) + expression + source.slice(finish)
}
export default { async fetch(request: Request, env: { DB: D1Database }) {
  let stage = 'input'
  let witness: Record<string, unknown> = {}
  let nativeMeta: unknown = null
  try {
    const input = await request.json() as { id: number; expression: number }
    if (!Number.isSafeInteger(input.id) || input.id < 1 || !Number.isInteger(input.expression) || !expressions[input.expression]) throw new Error('Invalid private probe selector')
    const expression = expressions[input.expression]
    stage = 'source-generators'
    const old = oldUpper(expression)
    const defaultSql = candidateUpper(expression)
    const control = candidateUpper(expression, 'control')
    const data = candidateUpper(expression, 'data')
    const noNul = replaceOne(data, `instr(CAST(${expression} AS BLOB),x'00')=0 AND `, '')
    const n = `length(CAST(${expression} AS BLOB))`
    const quotes = `(${n}-length(CAST(replace(${expression},char(34),'') AS BLOB)))`
    const slashes = `(${n}-length(CAST(replace(${expression},char(92),'') AS BLOB)))`
    const text2 = replaceTextBranch(data, `2+2*${n}`)
    const ascii1 = replaceTextBranch(data, `2+${n}`)
    const noQuote = replaceTextBranch(data, `2+${n}+${slashes}`)
    const noSlash = replaceTextBranch(data, `2+${n}+${quotes}`)
    const integer19 = replaceOne(data, "WHEN 'integer' THEN 20", "WHEN 'integer' THEN 19")
    const generated = { old, oldExtraData: oldUpper(expression, 'data'), default: defaultSql, control, data,
      noNul, text2, integer19, ascii1, noQuote, noSlash }
    const columns = Object.entries(generated).map(([key, sql]) => `(${sql}) AS "upper_${key}"`)
    const sql = `SELECT ${expression} AS value,typeof(${expression}) AS storage_type,length(CAST(${expression} AS BLOB)) AS stored_bytes,${columns.join(',')} FROM scalar_values p WHERE p.id=?`
    witness = { id: input.id, expression, generated, sql }
    stage = 'native-select'
    const result = await env.DB.prepare(sql).bind(input.id).all<Record<string, unknown>>()
    nativeMeta = result.meta
    if (result.success !== true || !Array.isArray(result.results) || result.results.length !== 1) throw new Error('Native scalar result arity/success mismatch')
    const row = result.results[0]
    if (!Object.prototype.hasOwnProperty.call(row, 'value')) throw new Error('Native scalar result omitted value')
    witness.observed_js_type = row.value === null ? 'null' : typeof row.value
    witness.observed_tag = Object.prototype.toString.call(row.value)
    stage = 'json-stringify-native-value'
    const json = JSON.stringify(row.value)
    if (typeof json !== 'string') throw new Error('Native scalar value has no JSON representation')
    const actualBytes = encoder.encode(json).byteLength
    const bounds: Record<string, unknown> = {}
    for (const key of Object.keys(generated)) bounds[key] = row['upper_' + key]
    return Response.json({ ok: true, id: input.id, expression, generated, sql, native_success: result.success, native_meta: result.meta,
      storage_type: row.storage_type, stored_bytes: row.stored_bytes, bounds,
      actual: { json, utf8_bytes: actualBytes, js_type: row.value === null ? 'null' : typeof row.value,
        tag: Object.prototype.toString.call(row.value), binary_hex: row.storage_type === 'blob' ? binaryHex(row.value) : null,
        number_text: typeof row.value === 'number' ? String(row.value) : null,
        finite: typeof row.value === 'number' ? Number.isFinite(row.value) : null },
      native_row: row, scope: 'Actual D1 value JSON bytes and exact source-generated scalar SQL only; not row/envelope/financial/coherence/CPU/Free certification.' })
  } catch (error) {
    return Response.json({ ...witness, ok: false, stage, error: errorValue(error), native_meta: nativeMeta,
      scope: 'Error/unsupported conversion preserved; not a zero-byte success.' })
  }
} }
