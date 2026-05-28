import { buildZip } from './csv.ts'

interface CsvExportWorkerRequest {
  id?: unknown
  files?: unknown[]
}

type CsvExportFile = {
  name?: string
  filename?: string
  content?: string
  rows?: unknown[]
}

interface CsvExportWorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<CsvExportWorkerRequest>) => void): void
  postMessage(message: unknown): void
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'CSV export worker failed')
}

const workerSelf = self as unknown as CsvExportWorkerScope

workerSelf.addEventListener('message', (event: MessageEvent<CsvExportWorkerRequest>) => {
  const { id, files } = event.data || {}
  try {
    const blob = buildZip(Array.isArray(files) ? files as CsvExportFile[] : [])
    workerSelf.postMessage({ id, type: 'result', blob })
  } catch (error) {
    workerSelf.postMessage({ id, type: 'error', error: getErrorMessage(error) })
  }
})
