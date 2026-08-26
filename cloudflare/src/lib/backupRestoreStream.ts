// Streaming reader for a business-os backup document (item 10.1).
//
// The WRITE path (backup.ts::writeBackupDocument) already streams the manifest
// to R2 a page at a time, so a large database can be backed up without ever
// being fully resident. Its mirror, restore, did NOT: it called
// `object.json()` — parsing the ENTIRE document into one JS object — and then
// built a second array holding an INSERT for every row before applying any.
// A database big enough to have caused the original backup OOM would OOM
// restoring its own backup, which is the worse failure (you reach for a
// restore precisely when things are already bad).
//
// This module reads the SAME document as a byte stream and emits one table /
// one row at a time, so the restore loop can apply rows in bounded batches
// without holding the whole thing. Peak memory is one row's worth of text
// plus a small carry buffer, not the whole backup.
//
// SAFETY: this scanner never interprets a row's CONTENTS. It only finds the
// BOUNDARIES of each JSON token (string, object, array) — brace/bracket depth
// with proper string + escape awareness — and hands the exact substring to the
// trusted, built-in `JSON.parse`. So the only JSON semantics in play are the
// platform's own. If the document is truncated or corrupted, `JSON.parse`
// throws and the restore aborts — a loud, safe failure, never a silent
// mis-restore. That property is what the tests pin.
//
// The document shape (see writeBackupDocument):
//   {"format":..,"formatVersion":1,"createdAt":..,"source":..,
//    "runtime":..,"tables":{
//       "<name>":{"columns":[..],"rows":[{..},{..},..]},
//       ...
//    },"r2":{..},"summary":{..}}
// Restore only needs `tables`; everything after it is ignored.

export type BackupStreamEvent =
  | { type: 'table'; table: string; columns: string[] }
  | { type: 'row'; table: string; row: Record<string, unknown> }
  // The small top-level metadata objects that follow `tables` (asset copy
  // list, summary counts). Emitted so restore can put back the copied R2
  // assets without a second full parse. These are bounded (asset keys), not
  // the whole database, so capturing them keeps memory low.
  | { type: 'meta'; key: string; value: unknown }

type State =
  | 'outer-open'          // before the top-level {
  | 'outer-key'           // at a key inside the top-level object (or })
  | 'outer-colon'         // consumed a top-level key, expect :
  | 'outer-capture-value' // read a non-tables value (capture r2/summary, skip rest)
  | 'outer-sep'           // after a top-level value: , or }
  | 'tables-open'         // expect { after "tables":
  | 'table-key'           // a table name string, or } ending tables
  | 'table-colon'         // expect : after a table name
  | 'table-body-open'     // expect { opening a table body
  | 'table-body-key'      // "columns"/"rows" key, or } ending the body
  | 'table-body-colon'    // expect : after a body key
  | 'body-skip-value'     // skip an unrecognised table-body value
  | 'columns-value'       // read the columns array
  | 'rows-open'           // expect [ after "rows":
  | 'rows-item'           // a row object, or ] ending rows
  | 'rows-sep'            // , (next row) or ] (end)
  | 'table-body-sep'      // , (next body key) or } (end of table body)
  | 'tables-sep'          // , (next table) or } (end of tables)
  | 'done'                // tables fully consumed; ignore the rest

/**
 * Incremental, chunk-safe scanner. Feed text with push(); it returns the
 * events that completed on that chunk. A token split across chunk boundaries
 * is carried forward and re-scanned when more text arrives, so the caller can
 * feed arbitrary byte/character slices (as a network stream does).
 */
export class BackupDocumentScanner {
  private buf = ''
  private i = 0
  private state: State = 'outer-open'
  private currentTable = ''
  private pendingColumns: string[] | null = null
  private emittedTableFor = ''
  private outerKey = ''

  push(text: string): BackupStreamEvent[] {
    // Drop already-consumed prefix so the buffer never grows without bound.
    if (this.i > 0) {
      this.buf = this.buf.slice(this.i)
      this.i = 0
    }
    this.buf += text
    const events: BackupStreamEvent[] = []
    this.run(events)
    return events
  }

  /**
   * Assert the stream ended cleanly. 'done' is the only clean terminal: it is
   * reached exactly when the tables object's closing } is consumed, so any
   * other state means the document was truncated mid-structure — a restore
   * MUST refuse a partial backup rather than apply half of it.
   */
  end(): void {
    if (this.state !== 'done') {
      throw new Error(`Backup stream ended mid-document (state: ${this.state}) — the backup is truncated`)
    }
  }

  private run(events: BackupStreamEvent[]): void {
    // Each step() either makes progress (returns true) or blocks on more input
    // (false). Every true-returning transition consumes input or advances the
    // state toward consuming it, so this cannot spin.
    for (;;) {
      if (!this.step(events)) return
      if (this.state === 'done') return
    }
  }

  /** One state transition. Returns false when it needs more input. */
  private step(events: BackupStreamEvent[]): boolean {
    switch (this.state) {
      case 'outer-open': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] !== '{') throw new Error('Backup document must start with an object')
        this.i = j + 1
        this.state = 'outer-key'
        return true
      }
      case 'outer-key': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] === '}') { this.i = j + 1; this.state = 'done'; return true }
        const str = readString(this.buf, j)
        if (!str) return false
        this.i = str.next
        this.outerKey = str.value
        this.state = 'outer-colon'
        return true
      }
      case 'outer-colon': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] !== ':') throw new Error('Expected : after object key')
        this.i = j + 1
        this.state = this.outerKey === 'tables' ? 'tables-open' : 'outer-capture-value'
        return true
      }
      case 'outer-capture-value': {
        const tok = readValue(this.buf, this.i)
        if (!tok) return false
        // Capture only the small post-tables metadata (asset copy list, summary
        // counts); everything else at the top level is skipped. These are
        // bounded, unlike the tables, so holding one briefly is fine.
        //
        // Metadata parsing is DELIBERATELY tolerant: r2/summary follow all the
        // table rows, which the restore has already applied by this point.
        // Asset restore is best-effort anyway (see restore's missingAssets), so
        // a corrupt asset list must NOT throw and undo a good table restore.
        // Row parsing above stays strict -- that is the data that must never be
        // silently mangled.
        if (this.outerKey === 'r2' || this.outerKey === 'summary') {
          try {
            events.push({ type: 'meta', key: this.outerKey, value: JSON.parse(tok.raw) })
          } catch (_) {
            // Unparseable metadata: skip it, keep the (already-applied) tables.
          }
        }
        this.i = tok.next
        this.state = 'outer-sep'
        return true
      }
      case 'outer-sep': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] === ',') { this.i = j + 1; this.state = 'outer-key'; return true }
        if (this.buf[j] === '}') { this.i = j + 1; this.state = 'done'; return true }
        throw new Error('Expected , or } in top-level object')
      }
      case 'tables-open': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] !== '{') throw new Error('Expected { after "tables":')
        this.i = j + 1
        this.state = 'table-key'
        return true
      }
      case 'table-key': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        // End of the tables object (possibly empty). Continue the outer object
        // so r2/summary are still read.
        if (this.buf[j] === '}') { this.i = j + 1; this.state = 'outer-sep'; return true }
        const str = readString(this.buf, j)
        if (!str) return false
        this.currentTable = str.value
        this.pendingColumns = null
        this.emittedTableFor = ''
        this.i = str.next
        this.state = 'table-colon'
        return true
      }
      case 'table-colon': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] !== ':') throw new Error('Expected : after table name')
        this.i = j + 1
        this.state = 'table-body-open'
        return true
      }
      case 'table-body-open': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] !== '{') throw new Error('Expected { opening a table body')
        this.i = j + 1
        this.state = 'table-body-key'
        return true
      }
      case 'table-body-key': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] === '}') { this.i = j + 1; this.state = 'tables-sep'; return true }
        const str = readString(this.buf, j)
        if (!str) return false
        this.i = str.next
        this.bodyKey = str.value
        this.state = 'table-body-colon'
        return true
      }
      case 'table-body-colon': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] !== ':') throw new Error('Expected : after table body key')
        this.i = j + 1
        this.state = this.bodyKey === 'rows' ? 'rows-open' : (this.bodyKey === 'columns' ? 'columns-value' : 'body-skip-value')
        return true
      }
      case 'body-skip-value': {
        const tok = readValue(this.buf, this.i)
        if (!tok) return false
        this.i = tok.next
        this.state = 'table-body-sep'
        return true
      }
      case 'columns-value': {
        const tok = readValue(this.buf, this.i)
        if (!tok) return false
        const parsed = JSON.parse(tok.raw)
        this.pendingColumns = Array.isArray(parsed) ? parsed.map((c) => String(c)) : []
        this.i = tok.next
        this.state = 'table-body-sep'
        return true
      }
      case 'rows-open': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] !== '[') throw new Error('Expected [ after "rows":')
        this.i = j + 1
        // Emit the table event now (columns known by our writer's ordering).
        this.emitTable(events)
        this.state = 'rows-item'
        return true
      }
      case 'rows-item': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] === ']') { this.i = j + 1; this.state = 'table-body-sep'; return true }
        const tok = readValue(this.buf, j)
        if (!tok) return false
        const row = JSON.parse(tok.raw) as Record<string, unknown>
        events.push({ type: 'row', table: this.currentTable, row })
        this.i = tok.next
        this.state = 'rows-sep'
        return true
      }
      case 'rows-sep': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] === ',') { this.i = j + 1; this.state = 'rows-item'; return true }
        if (this.buf[j] === ']') { this.i = j + 1; this.state = 'table-body-sep'; return true }
        throw new Error('Expected , or ] in rows array')
      }
      case 'table-body-sep': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] === ',') { this.i = j + 1; this.state = 'table-body-key'; return true }
        if (this.buf[j] === '}') { this.i = j + 1; this.state = 'tables-sep'; return true }
        throw new Error('Expected , or } in table body')
      }
      case 'tables-sep': {
        const j = skipWs(this.buf, this.i)
        if (j >= this.buf.length) return false
        if (this.buf[j] === ',') { this.i = j + 1; this.state = 'table-key'; return true }
        // The tables object just closed; we are back in the outer object, so
        // continue it to reach r2/summary (and the final }), not straight to
        // done -- restore needs the asset copy list that follows.
        if (this.buf[j] === '}') { this.i = j + 1; this.state = 'outer-sep'; return true }
        throw new Error('Expected , or } in tables object')
      }
      case 'done':
        return false
      default:
        return false
    }
  }

  private bodyKey = ''

  private emitTable(events: BackupStreamEvent[]): void {
    if (this.emittedTableFor === this.currentTable) return
    this.emittedTableFor = this.currentTable
    events.push({ type: 'table', table: this.currentTable, columns: this.pendingColumns || [] })
  }
}

// --- boundary scanners (string + escape aware; never interpret content) ----

function skipWs(s: string, i: number): number {
  let j = i
  while (j < s.length) {
    const c = s[j]
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') j += 1
    else break
  }
  return j
}

/** Reads a JSON string starting at s[i] === '"'. Null if incomplete. */
function readString(s: string, i: number): { value: string; next: number } | null {
  if (s[i] !== '"') return null
  let j = i + 1
  let esc = false
  for (; j < s.length; j += 1) {
    const c = s[j]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') {
      const raw = s.slice(i, j + 1)
      return { value: JSON.parse(raw) as string, next: j + 1 }
    }
  }
  return null // ran out mid-string
}

/**
 * Finds the boundary of ONE JSON value starting at (whitespace before) i:
 * an object, array, string, or primitive. Returns the exact raw substring and
 * the index after it, or null if the value is not yet complete in the buffer.
 *
 * Objects/arrays are scanned by depth with string+escape awareness so braces
 * or brackets INSIDE a string never miscount. Primitives (number/true/false/
 * null) are read up to the next structural delimiter; because a primitive at
 * the very end of the buffer might still be growing, an unterminated primitive
 * returns null and is retried when more text arrives.
 */
function readValue(s: string, i: number): { raw: string; next: number } | null {
  const start = skipWs(s, i)
  if (start >= s.length) return null
  const c = s[start]
  if (c === '"') {
    const str = readString(s, start)
    return str ? { raw: s.slice(start, str.next), next: str.next } : null
  }
  if (c === '{' || c === '[') {
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = start; j < s.length; j += 1) {
      const ch = s[j]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{' || ch === '[') depth += 1
      else if (ch === '}' || ch === ']') {
        depth -= 1
        if (depth === 0) return { raw: s.slice(start, j + 1), next: j + 1 }
      }
    }
    return null // unterminated object/array
  }
  // primitive: number, true, false, null — ends at a structural delimiter.
  let j = start
  for (; j < s.length; j += 1) {
    const ch = s[j]
    if (ch === ',' || ch === '}' || ch === ']' || ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') break
  }
  if (j >= s.length) return null // might still be growing
  return { raw: s.slice(start, j), next: j }
}

/**
 * Convenience: drive the scanner over a whole ReadableStream of UTF-8 bytes,
 * yielding events. Used by the restore path; the pure scanner above is what
 * the tests exercise directly with adversarial chunkings.
 */
export async function* streamBackupEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<BackupStreamEvent> {
  const scanner = new BackupDocumentScanner()
  const decoder = new TextDecoder('utf-8')
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      if (!text) continue
      for (const ev of scanner.push(text)) yield ev
    }
    const tail = decoder.decode()
    if (tail) for (const ev of scanner.push(tail)) yield ev
    scanner.end()
  } finally {
    reader.releaseLock()
  }
}
