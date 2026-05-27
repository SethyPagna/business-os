import { countCsvDataRows } from '../../utils/csvRowCounter.mjs'

type IncomingSalesImportMessage = {
  id?: string
  text?: string
}

type ResultMessage = {
  id?: string
  type: 'result'
  rowCount: number
}

type ErrorMessage = {
  id?: string
  type: 'error'
  error: string
}

type SalesImportWorkerScope = {
  postMessage(message: ResultMessage | ErrorMessage): void
  addEventListener(type: 'message', listener: (event: MessageEvent<IncomingSalesImportMessage>) => void): void
}

const workerSelf = self as unknown as SalesImportWorkerScope

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Sales import parsing failed'
}

workerSelf.addEventListener('message', (event) => {
  const { id, text = '' } = event.data || {}
  try {
    workerSelf.postMessage({ id, type: 'result', rowCount: countCsvDataRows(text) })
  } catch (error) {
    workerSelf.postMessage({ id, type: 'error', error: getErrorMessage(error) })
  }
})
