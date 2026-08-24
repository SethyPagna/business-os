import { analyzeProductImportText } from './productImportPlanner'

type ExistingProductRecord = Record<string, unknown>

type IncomingImportMessage = {
  id?: string
  text?: string
  existingProducts?: ExistingProductRecord[]
}

type ProgressMessage = {
  id?: string
  type: 'progress'
  progress: number
  label: string
}

type ResultMessage = {
  id?: string
  type: 'result'
  result: ReturnType<typeof analyzeProductImportText>
}

type ErrorMessage = {
  id?: string
  type: 'error'
  error: string
}

type OutgoingImportMessage = ProgressMessage | ResultMessage | ErrorMessage

type ProductImportWorkerScope = {
  postMessage(message: OutgoingImportMessage): void
  addEventListener(type: 'message', listener: (event: MessageEvent<IncomingImportMessage>) => void): void
}

const workerSelf = self as unknown as ProductImportWorkerScope

function post(message: OutgoingImportMessage) {
  workerSelf.postMessage(message)
}

function waitForNextTask() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Import analysis failed'
}

workerSelf.addEventListener('message', async (event) => {
  const { id, text = '', existingProducts = [] } = event.data || {}
  try {
    post({ id, type: 'progress', progress: 5, label: 'Reading file' })
    await waitForNextTask()
    post({ id, type: 'progress', progress: 35, label: 'Parsing rows' })
    const analysis = analyzeProductImportText(text, existingProducts)
    post({ id, type: 'progress', progress: 80, label: 'Planning conflicts' })
    await waitForNextTask()
    post({ id, type: 'progress', progress: 100, label: 'Ready' })
    post({ id, type: 'result', result: analysis })
  } catch (error) {
    post({ id, type: 'error', error: getErrorMessage(error) })
  }
})
