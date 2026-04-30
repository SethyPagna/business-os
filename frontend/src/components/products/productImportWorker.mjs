import { analyzeProductImportText } from './productImportPlanner.mjs'

function post(id, payload) {
  self.postMessage({ id, ...payload })
}

self.addEventListener('message', async (event) => {
  const { id, text, existingProducts } = event.data || {}
  try {
    post(id, { type: 'progress', progress: 5, label: 'Reading file' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    post(id, { type: 'progress', progress: 35, label: 'Parsing rows' })
    const analysis = analyzeProductImportText(text || '', existingProducts || [])
    post(id, { type: 'progress', progress: 80, label: 'Planning conflicts' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    post(id, { type: 'progress', progress: 100, label: 'Ready' })
    post(id, { type: 'result', result: analysis })
  } catch (error) {
    post(id, { type: 'error', error: error?.message || 'Import analysis failed' })
  }
})
