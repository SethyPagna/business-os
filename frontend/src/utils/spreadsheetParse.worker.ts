import { spreadsheetBytesToDelimitedText } from './spreadsheetWorkbook.ts'

type ParseRequest = {
  id?: string
  bytes?: ArrayBuffer
  sheetName?: string
}

type ParseReply =
  | { id?: string; type: 'result'; content: string }
  | { id?: string; type: 'error' }

type SpreadsheetParseScope = {
  postMessage(message: ParseReply): void
  addEventListener(type: 'message', listener: (event: MessageEvent<ParseRequest>) => void): void
}

const workerSelf = self as unknown as SpreadsheetParseScope

workerSelf.addEventListener('message', (event) => {
  const { id, bytes, sheetName } = event.data || {}
  try {
    if (!(bytes instanceof ArrayBuffer)) throw new Error('No file bytes')
    const content = spreadsheetBytesToDelimitedText(bytes, typeof sheetName === 'string' ? sheetName : undefined)
    workerSelf.postMessage({ id, type: 'result', content })
  } catch {
    workerSelf.postMessage({ id, type: 'error' })
  }
})
