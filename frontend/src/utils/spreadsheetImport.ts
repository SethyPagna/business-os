// Universal import-file reader: CSV, TSV, and real Excel (.xlsx/.xls/.xlsm).
//
// WHY THIS EXISTS: every import entry point in this app (products, inventory,
// contacts, sales) ends up calling openCSVDialog() (api/browserDialogs.ts),
// which used to only accept .csv/.tsv and read the file as raw text via
// decodeTextBuffer. That's the root cause of two separate real-world bugs
// reported by operators:
//
//   1. "Khmer text turns into question marks" -- this almost never happens
//      on the read side (decodeTextBuffer already handles UTF-8/UTF-16
//      correctly). It happens earlier: a CSV round-tripped through Excel
//      gets re-saved using Excel's plain "CSV (Comma delimited)" option,
//      which writes the system ANSI codepage (e.g. Windows-1252), not UTF-8
//      -- Windows-1252 cannot represent Khmer glyphs at all, so they become
//      literal '?' before the file ever reaches this app. Plain CSV has no
//      way to prevent that; it's a structural limitation of the format.
//
//   2. "Barcode numbers turn into scientific notation / lose digits" --
//      Excel's default "General" number format switches to scientific
//      notation once an integer gets long enough (which most 12-13 digit
//      barcodes are), and CSV has no per-column type info to mark a column
//      "Text" and stop that.
//
// Real .xlsx sidesteps both structurally: it always stores text as UTF-8 in
// its underlying XML (no ANSI ambiguity, ever), and cells carry real type
// info so a column can be explicitly typed Text (see utils/xlsxExport.ts for
// the export side, which forces barcode-shaped columns to Text so a file
// this app generates never re-introduces the problem on the next round
// trip).
//
// A parsed .xlsx sheet is converted into the exact same delimited text shape
// a .csv upload already produces (spreadsheetWorkbook.ts), so nothing
// downstream -- analyzeProductImportText, parseCsvRows, the backend's
// importCsv.ts, all of it -- needs to know or care that the original file was
// Excel.
//
// WHERE IT RUNS: SheetJS 0.18.5 carries prototype-pollution and ReDoS
// advisories with no patched npm release, and an imported workbook is
// untrusted input. So that conversion never runs here: each Excel file gets a
// worker of its own (spreadsheetParse.worker.ts) that is terminated after the
// result, after a timeout, or on cancel, and the only thing that comes back
// across the boundary is one string. A polluted or hung parser dies with its
// worker. Where no worker can be made, the Excel file is refused, never parsed
// on this thread.
import { decodeTextBuffer } from './csvImport.ts'

export type ImportFileResult = {
  content: string
  name: string
}

export type SpreadsheetWorkerHandle = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>

export type SpreadsheetParseOptions = {
  createWorker?: () => SpreadsheetWorkerHandle
  timeoutMs?: number
  signal?: AbortSignal
}

const SPREADSHEET_EXTENSION_PATTERN = /\.(xlsx|xlsm|xls)$/i

const SPREADSHEET_PARSE_BASE_TIMEOUT_MS = 20_000
const SPREADSHEET_PARSE_PER_MB_TIMEOUT_MS = 3_000
const SPREADSHEET_PARSE_MAX_TIMEOUT_MS = 120_000

// English only when the language pack cannot be loaded; equal to en.json's
// values (spreadsheetWorkerParse.test.ts pins them).
export const SPREADSHEET_FAILURES = {
  unavailable: {
    key: 'spreadsheet_import_unavailable',
    english: 'This browser cannot read Excel files safely. Save the sheet as CSV and import that, or update your browser.',
  },
  timeout: {
    key: 'spreadsheet_import_timeout',
    english: 'That Excel file took too long to read, so it was stopped. Save the sheet as CSV and import that instead.',
  },
  unreadable: {
    key: 'spreadsheet_import_unreadable',
    english: 'Could not read that Excel file. Check that it is a valid .xlsx or .xls file, or save the sheet as CSV.',
  },
} as const

type SpreadsheetFailureKind = keyof typeof SPREADSHEET_FAILURES

export function isSpreadsheetFileName(fileName: string): boolean {
  return SPREADSHEET_EXTENSION_PATTERN.test(String(fileName || '').trim())
}

export function spreadsheetParseTimeoutMs(byteLength: number): number {
  const megabytes = Math.ceil(Math.max(0, byteLength) / 1_048_576)
  return Math.min(SPREADSHEET_PARSE_MAX_TIMEOUT_MS, SPREADSHEET_PARSE_BASE_TIMEOUT_MS + megabytes * SPREADSHEET_PARSE_PER_MB_TIMEOUT_MS)
}

// The message in the UI language AppContext applies to <html lang>, read from
// the same language pack the screens use. Callers show error.message as is.
async function spreadsheetFailure(kind: SpreadsheetFailureKind): Promise<Error> {
  const { key, english } = SPREADSHEET_FAILURES[kind]
  let message: string = english
  try {
    const language = typeof document !== 'undefined' ? String(document.documentElement?.getAttribute('lang') || '').trim().toLowerCase() : ''
    const pack = (language.startsWith('km') ? (await import('../lang/km.json')).default : (await import('../lang/en.json')).default) as Record<string, unknown>
    const value = pack[key]
    if (typeof value === 'string' && value.trim()) message = value
  } catch {
    // Keep the English.
  }
  return Object.assign(new Error(message), { code: key })
}

function createSpreadsheetWorker(): SpreadsheetWorkerHandle {
  return new Worker(new URL('./spreadsheetParse.worker.ts', import.meta.url), { type: 'module' })
}

// Copies the one field this module accepts out of a worker reply into a fresh
// object. Nothing else the message carries (a __proto__ or constructor key, a
// function, a nested object) is read, let alone copied.
export function readSpreadsheetReply(raw: unknown, id: string): { content: string } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const own = (key: string): unknown => (Object.prototype.hasOwnProperty.call(raw, key) ? Reflect.get(raw, key) : undefined)
  if (own('id') !== id || own('type') !== 'result') return null
  const content = own('content')
  return typeof content === 'string' ? { content } : null
}

export function parseSpreadsheetInWorker(bytes: ArrayBuffer, sheetName?: string, options: SpreadsheetParseOptions = {}): Promise<string> {
  const { signal } = options
  const timeoutMs = options.timeoutMs ?? spreadsheetParseTimeoutMs(bytes.byteLength)
  return new Promise<string>((resolve, reject) => {
    const cancelled = () => new DOMException('The import was cancelled.', 'AbortError')
    if (signal?.aborted) {
      reject(cancelled())
      return
    }
    let worker: SpreadsheetWorkerHandle
    try {
      worker = (options.createWorker ?? createSpreadsheetWorker)()
    } catch {
      void spreadsheetFailure('unavailable').then(reject)
      return
    }
    const id = `spreadsheet-${Date.now()}-${Math.random().toString(36).slice(2)}`
    let finished = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function finish(settle: () => void): void {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      settle()
    }
    function fail(kind: SpreadsheetFailureKind): void {
      finish(() => { void spreadsheetFailure(kind).then(reject) })
    }
    function onAbort(): void {
      finish(() => reject(cancelled()))
    }

    worker.onmessage = (event: MessageEvent<unknown>) => {
      const reply = readSpreadsheetReply(event.data, id)
      if (reply) finish(() => resolve(reply.content))
      else fail('unreadable')
    }
    worker.onmessageerror = () => fail('unreadable')
    worker.onerror = () => fail('unavailable')
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => fail('timeout'), timeoutMs)
    try {
      worker.postMessage({ id, bytes, sheetName }, [bytes])
    } catch {
      fail('unavailable')
    }
  })
}

// Single entry point every import dialog/drop-zone should call. Detects
// CSV/TSV vs. Excel by extension and returns the same { content, name }
// shape either way -- callers (openCSVDialog, FileDropZone, and every
// *ImportModal.tsx that consumes their result) don't need to change at all.
export async function parseImportFile(file: File, sheetName?: string, options?: SpreadsheetParseOptions): Promise<ImportFileResult> {
  const name = file.name || 'import'
  if (isSpreadsheetFileName(name)) {
    return { content: await parseSpreadsheetInWorker(await file.arrayBuffer(), sheetName, options), name }
  }
  const content = decodeTextBuffer(await file.arrayBuffer())
  return { content, name }
}
