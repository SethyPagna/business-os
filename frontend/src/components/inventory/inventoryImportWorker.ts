import { countCsvDataRows } from '../../utils/csvRowCounter'

type IncomingInventoryImportMessage = {
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

type InventoryImportWorkerScope = {
  postMessage(message: ResultMessage | ErrorMessage): void
  addEventListener(type: 'message', listener: (event: MessageEvent<IncomingInventoryImportMessage>) => void): void
}

const workerSelf = self as unknown as InventoryImportWorkerScope

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Inventory import parsing failed'
}

workerSelf.addEventListener('message', (event) => {
  const { id, text = '' } = event.data || {}
  try {
    workerSelf.postMessage({ id, type: 'result', rowCount: countCsvDataRows(text) })
  } catch (error) {
    workerSelf.postMessage({ id, type: 'error', error: getErrorMessage(error) })
  }
})
