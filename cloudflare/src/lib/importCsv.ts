// Ported from backend/src/importCsv.ts. Pure string/array logic, no Node
// APIs involved in this subset -- exact behavioral port, not an
// approximation. (The Node-fs-stream-based batch generator in the original
// file is intentionally left out; see the file-level note above.)

export type ParsedCsvRow = Record<string, unknown> & { _rowNumber: number }

export function stripBom(value: unknown): string {
  return String(value || '').replace(/^\uFEFF/, '')
}

function countDelimiter(line: string, delimiter: string): number {
  let count = 0
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const nextChar = line[index + 1]
    if (char === '"' && inQuotes && nextChar === '"') {
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === delimiter && !inQuotes) count += 1
  }
  return count
}

export function detectCsvDelimiter(text: unknown): string {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] || ''
  const delimiters = [',', '\t', ';']
  let bestDelimiter = ','
  let bestCount = -1
  for (const delimiter of delimiters) {
    const count = countDelimiter(firstLine, delimiter)
    if (count > bestCount) {
      bestDelimiter = delimiter
      bestCount = count
    }
  }
  return bestDelimiter
}

export function hasDelimitedRowContent(values: unknown[] = []): boolean {
  for (const value of values) {
    if (String(value || '').trim() !== '') return true
  }
  return false
}

function parseDelimitedRows(text: unknown, delimiter: string): string[][] {
  const source = stripBom(String(text || ''))
  const rows: string[][] = []
  let row: string[] = []
  let current = ''
  let inQuotes = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const nextChar = source[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === delimiter && !inQuotes) {
      row.push(current)
      current = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(current)
      if (hasDelimitedRowContent(row)) rows.push(row)
      row = []
      current = ''
      continue
    }
    current += char
  }
  row.push(current)
  if (hasDelimitedRowContent(row)) rows.push(row)
  return rows
}

export type DelimitedRowsWindow = {
  rows: string[][]
  nextIndex: number
  nextInQuotes: boolean
  done: boolean // true once this window reached the end of `source`
}

// Resumable sibling of parseDelimitedRows: instead of scanning the whole
// text in one pass, starts at a saved character offset + quote-state (both
// returned by a previous call) and stops after extracting `maxRows`
// complete rows, or at end of text -- whichever comes first. Same
// char-by-char quote/delimiter tracking as parseDelimitedRows above (kept
// in sync with it deliberately), just checkpointable across many calls
// instead of needing to run start-to-finish inside one invocation.
//
// `source` must already be BOM-stripped by the caller (via stripBom) --
// stripping it here on every window would work at startIndex 0 but silently
// misalign every later window's offsets against the original un-stripped
// text length, since callers persist/resume offsets against whatever
// string they passed in. Strip once, up front, before the first call.
//
// See importEngine.ts's ensureSourceRowsMaterialized, the sole caller --
// added so a huge CSV/XLSX-derived file's one-time parse cost can be spread
// across many fresh-CPU-budget invocations the same way ROWS_PER_IMPORT_CHUNK
// already spreads out the classify/write cost (migration 0011), instead of
// paying the whole file's parse cost again on every single chunk the way
// parseCsvRows-via-fetchDecidedRows used to.
export function parseDelimitedRowsWindow(
  source: string,
  delimiter: string,
  startIndex: number,
  startInQuotes: boolean,
  maxRows: number,
): DelimitedRowsWindow {
  const rows: string[][] = []
  let row: string[] = []
  let current = ''
  let inQuotes = startInQuotes
  let index = startIndex

  for (; index < source.length; index += 1) {
    if (rows.length >= maxRows) break
    const char = source[index]
    const nextChar = source[index + 1]

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"'
      index += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === delimiter && !inQuotes) {
      row.push(current)
      current = ''
      continue
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(current)
      if (hasDelimitedRowContent(row)) rows.push(row)
      row = []
      current = ''
      continue
    }
    current += char
  }

  const done = index >= source.length
  if (done) {
    // Flush a trailing row with no final newline, same as parseDelimitedRows
    // does at EOF. If we stopped early because we hit maxRows instead, there
    // is nothing pending here -- the loop only exits mid-row via the
    // maxRows break, which can only happen right after a completed row was
    // just pushed (the break check runs before consuming the next row's
    // first character), so `row`/`current` are always fresh/empty in that
    // case and this flush is a no-op there.
    row.push(current)
    if (hasDelimitedRowContent(row)) rows.push(row)
  }

  // `index` already points at the next unconsumed character in BOTH exit
  // paths: when maxRows is hit, the break fires at the top of an iteration
  // (before that iteration's own index += 1 would run), so index is still
  // exactly where the next row starts; when the loop exhausts the source
  // naturally, index === source.length, which is a fine (if unused, since
  // done=true) value too. No +1 here -- an earlier version added one and
  // silently ate the first character of whatever followed a maxRows-cut
  // window, which a quoted or multi-window field would then parse wrong in
  // a way a small/EOF-only test would never surface (see the resumable
  // window fuzz test this was caught by).
  return { rows, nextIndex: index, nextInQuotes: inQuotes, done }
}

export function normalizeCsvKey(value: unknown): string {
  return stripBom(value)
    .trim()
    .replace(/^"|"$/g, '')
    .replace(/\s+/g, '_')
    .toLowerCase()
}

export function normalizeCsvHeaders(values: string[] = []): string[] {
  return values.map((value) => normalizeCsvKey(value))
}

// Backend port of frontend/src/utils/csvImport.ts's getDuplicateCsvHeaders
// and getBlankCsvHeaderColumns (Part 315's real-file audit) -- see that
// file's own header comments for the full "why". The frontend versions
// take raw CSV text and re-parse it synchronously in one pass; the backend
// import pipeline never has the whole file in memory at once (it
// materializes a huge CSV in small resumable windows -- see importEngine.ts's
// ensureSourceRowsMaterialized), so these versions take already-normalized
// headers (findDuplicateHeaderKeys) or are meant to be driven incrementally,
// one raw data-row at a time, across however many windows a job takes
// (findBlankHeaderIndexes below only needs the header row; the "does this
// blank column actually have data under it" check is accumulated by the
// caller across windows, not done here -- there is no single call that can
// see the whole file).
//
// Split out from the frontend originals (not literally shared code) since
// the two runtimes parse from different starting points -- this is a real
// logic port, kept behaviorally identical, not an approximation.

const EXCEL_DUPLICATE_SUFFIX_PATTERN = /\.\d+$/

export function findDuplicateHeaderKeys(normalizedHeaders: string[]): string[] {
  const keySet = new Set(normalizedHeaders.filter(Boolean))
  const duplicates = new Set<string>()

  const seen = new Set<string>()
  for (const key of normalizedHeaders) {
    if (!key) continue
    if (seen.has(key)) duplicates.add(key)
    seen.add(key)
  }

  for (const key of normalizedHeaders) {
    if (!EXCEL_DUPLICATE_SUFFIX_PATTERN.test(key)) continue
    const base = key.replace(EXCEL_DUPLICATE_SUFFIX_PATTERN, '')
    if (base && keySet.has(base)) duplicates.add(key)
  }

  return [...duplicates]
}

// 1-based column indexes (matching spreadsheet numbering, same convention
// as the frontend detector) whose header is blank. Callers must separately
// confirm at least one data row actually has a value in that column before
// treating it as a real warning -- a genuinely empty spare column at a
// sheet's ragged right edge is not a bug (see getBlankCsvHeaderColumns'
// comment on the frontend side for why that distinction matters).
export function findBlankHeaderIndexes(normalizedHeaders: string[]): number[] {
  const blank: number[] = []
  normalizedHeaders.forEach((header, index) => {
    if (!header) blank.push(index + 1)
  })
  return blank
}

export function hasParsedCsvRowContent(row: ParsedCsvRow): boolean {
  for (const [key, value] of Object.entries(row)) {
    if (key !== '_rowNumber' && String(value || '').trim() !== '') return true
  }
  return false
}

export function csvValuesToRow(values: string[], headers: string[], rowNumber: number): ParsedCsvRow {
  const row: ParsedCsvRow = { _rowNumber: rowNumber }
  for (let headerIndex = 0; headerIndex < headers.length; headerIndex += 1) {
    const header = headers[headerIndex]
    if (!header) continue
    const value = values[headerIndex]
    row[header] = typeof value === 'string' ? value.normalize('NFC').trim() : value
  }
  return row
}

// Row numbers are 1-based and match the CSV file line the row came from
// (header is row 1), same as the original -- these show up as-is in the
// review UI and errors.csv so a user can find the exact spreadsheet row.
export function parseCsvRows(text: unknown, options: { delimiter?: string } = {}): ParsedCsvRow[] {
  const delimiter = options.delimiter || detectCsvDelimiter(text)
  const rows = parseDelimitedRows(text, delimiter)
  if (rows.length < 2) return []
  const headers = normalizeCsvHeaders(rows[0])
  const parsedRows: ParsedCsvRow[] = []
  for (let index = 1; index < rows.length; index += 1) {
    const row = csvValuesToRow(rows[index], headers, index + 1)
    if (hasParsedCsvRowContent(row)) parsedRows.push(row)
  }
  return parsedRows
}
