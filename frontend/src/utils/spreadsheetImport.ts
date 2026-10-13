// Reads the file an import dialog hands over (CSV, TSV or Excel .xlsx/.xls/.xlsm)
// and returns the delimited text every importer already parses, so nothing
// downstream knows an Excel file was involved.
//
// Excel is read as a workbook, not as text, because a CSV loses what Excel
// keeps: a CSV re-saved as "CSV (Comma delimited)" is written in the system
// ANSI code page, which cannot hold Khmer, and Excel's General format shows a
// long barcode in scientific notation. A workbook stores text as UTF-8 and
// gives every cell a type (see utils/xlsxExport.ts for the export side, which
// writes barcode-shaped columns as Text).
//
// SheetJS 0.18.5 has prototype-pollution and ReDoS advisories and no patched
// npm release, and an imported workbook is untrusted input. So the conversion
// never runs on this thread: each Excel file gets a worker of its own
// (spreadsheetParse.worker.ts), terminated after the result, a timeout or a
// cancel, and one string is all that comes back. Where no worker can be made,
// the Excel file is refused rather than parsed here.
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

export const SPREADSHEET_MAX_BYTES = 25 * 1024 * 1024

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
  loadFailed: {
    key: 'spreadsheet_import_load_failed',
    english: 'The Excel reader could not be loaded. Check your connection, reload the page and try again.',
  },
  timeout: {
    key: 'spreadsheet_import_timeout',
    english: 'That Excel file took too long to read, so it was stopped. Save the sheet as CSV and import that instead.',
  },
  tooLarge: {
    key: 'spreadsheet_import_too_large',
    english: 'That Excel file is larger than 25 MB, so it was not opened. Keep only the sheet you need, or save it as CSV, and import that.',
  },
  unreadable: {
    key: 'spreadsheet_import_unreadable',
    english: 'Could not read that Excel file. Check that it is a valid .xlsx or .xls file, or save the sheet as CSV.',
  },
} as const

type SpreadsheetFailureKind = keyof typeof SPREADSHEET_FAILURES

let importFileReadsInFlight = 0
const importFileReadListeners = new Set<() => void>()

function setImportFileReadsInFlight(count: number): void {
  importFileReadsInFlight = count
  importFileReadListeners.forEach((listener) => listener())
}

// Lets a dialog hold its Import button, mode switches and file inputs while a
// file is still being read, so a late result can never land under a changed
// choice. Shaped for useSyncExternalStore.
export function subscribeToImportFileReads(listener: () => void): () => void {
  importFileReadListeners.add(listener)
  return () => { importFileReadListeners.delete(listener) }
}

export function isImportFileReadInFlight(): boolean {
  return importFileReadsInFlight > 0
}

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
  const byteLength = bytes.byteLength
  const timeoutMs = options.timeoutMs ?? spreadsheetParseTimeoutMs(byteLength)
  return new Promise<string>((resolve, reject) => {
    const cancelled = () => new DOMException('The import was cancelled.', 'AbortError')
    if (signal?.aborted) {
      reject(cancelled())
      return
    }
    if (byteLength > SPREADSHEET_MAX_BYTES) {
      void spreadsheetFailure('tooLarge').then(reject)
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
    worker.onerror = () => fail('loadFailed')
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
  setImportFileReadsInFlight(importFileReadsInFlight + 1)
  try {
    const name = file.name || 'import'
    if (isSpreadsheetFileName(name)) {
      if (file.size > SPREADSHEET_MAX_BYTES) throw await spreadsheetFailure('tooLarge')
      return { content: await parseSpreadsheetInWorker(await file.arrayBuffer(), sheetName, options), name }
    }
    const content = decodeTextBuffer(await file.arrayBuffer())
    return { content, name }
  } finally {
    setImportFileReadsInFlight(importFileReadsInFlight - 1)
  }
}
