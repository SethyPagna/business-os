import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')
const source = readFileSync(resolve(frontendRoot, 'src/components/files/FilePickerModal.tsx'), 'utf8').replace(/\r\n?/g, '\n')

assert.match(source, /import Modal from '\.\.\/shared\/Modal'/)
assert.doesNotMatch(source, /ModalBase as ComponentType/, 'the shared Modal contract must not be narrowed away')
assert.match(source, /<Modal title=\{title\} onClose=\{onClose\} wide layer=\{layer\} unsavedChanges="read-only">/)

class MemoryNode {
  nodeType: number
  nodeName: string
  tagName: string
  ownerDocument: MemoryDocument
  parentNode: MemoryNode | null = null
  childNodes: MemoryNode[] = []
  style: Record<string, string> = {}
  namespaceURI: string
  nodeValue = ''
  private ownText = ''
  private attributes = new Map<string, string>()

  constructor(nodeType: number, nodeName: string, ownerDocument: MemoryDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.tagName = nodeName
    this.ownerDocument = ownerDocument
    this.namespaceURI = namespaceURI
  }

  appendChild(child: MemoryNode): MemoryNode { child.parentNode = this; this.ownText = ''; this.childNodes.push(child); return child }
  insertBefore(child: MemoryNode, before: MemoryNode): MemoryNode {
    child.parentNode = this; this.ownText = ''
    const index = this.childNodes.indexOf(before)
    if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child)
    return child
  }
  removeChild(child: MemoryNode): MemoryNode {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  setAttribute(name: string, value: unknown): void { this.attributes.set(name, String(value)) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  focus(): void { this.ownerDocument.activeElement = this }
  contains(target: MemoryNode | null): boolean { return target === this || this.childNodes.some((child) => child.contains(target)) }
  get firstChild(): MemoryNode | null { return this.childNodes[0] ?? null }
  get lastChild(): MemoryNode | null { return this.childNodes[this.childNodes.length - 1] ?? null }
  get nextSibling(): MemoryNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return this.parentNode.childNodes[index + 1] ?? null
  }
  set textContent(value: string) { this.ownText = String(value); this.childNodes = [] }
  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue
    return this.childNodes.length ? this.childNodes.map((child) => child.textContent).join('') : this.ownText
  }
}

type MemoryDocument = {
  nodeType: number
  nodeName: string
  documentElement: MemoryNode
  body: MemoryNode
  activeElement: MemoryNode | null
  defaultView: Record<string, unknown> | null
  createElement: (name: string) => MemoryNode
  createElementNS: (namespaceURI: string, name: string) => MemoryNode
  createTextNode: (text: string) => MemoryNode
  addEventListener: () => void
  removeEventListener: () => void
}

const memoryDocument = {} as MemoryDocument
memoryDocument.nodeType = 9
memoryDocument.nodeName = '#document'
memoryDocument.defaultView = null
memoryDocument.createElement = (name) => new MemoryNode(1, name.toUpperCase(), memoryDocument)
memoryDocument.createElementNS = (namespaceURI, name) => new MemoryNode(1, name, memoryDocument, namespaceURI)
memoryDocument.createTextNode = (text) => {
  const node = new MemoryNode(3, '#text', memoryDocument)
  node.nodeValue = String(text)
  return node
}
memoryDocument.addEventListener = () => {}
memoryDocument.removeEventListener = () => {}
memoryDocument.documentElement = memoryDocument.createElement('html')
memoryDocument.body = memoryDocument.createElement('body')
memoryDocument.documentElement.appendChild(memoryDocument.body)
memoryDocument.activeElement = memoryDocument.documentElement

const memoryWindow = {
  document: memoryDocument,
  HTMLElement: MemoryNode,
  HTMLIFrameElement: class {},
  addEventListener() {},
  removeEventListener() {},
  getSelection() { return null },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
}
memoryDocument.defaultView = memoryWindow
Object.defineProperty(globalThis, 'window', { configurable: true, value: memoryWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: memoryDocument })
Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: MemoryNode })
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })

const vite = await createServer({
  root: frontendRoot,
  configFile: false,
  appType: 'custom',
  server: { middlewareMode: true },
  plugins: [
    {
      name: 'file-picker-lifecycle-mocks',
      enforce: 'pre',
      resolveId(id) {
        if (id.includes('AppContext')) return '\0file-picker-app-context'
        if (id.includes('api/fileTransport')) return '\0file-picker-transport'
        if (id.includes('shared/PaginationControls')) return '\0file-picker-pagination'
        return null
      },
      load(id) {
        if (id === '\0file-picker-app-context') return `export const useApp = () => ({ notify: (message, type) => { (globalThis.__pickerNotes ||= []).push([message, type]) }, user: null, t: (key) => key })`
        if (id === '\0file-picker-transport') return `export const getFiles = async () => ({ items: [], total: 0 }); export const isUploadTooLarge = (error) => error?.code === 'upload_too_large'; export const uploadFileAsset = (payload) => (globalThis.__pickerUploadHook ? globalThis.__pickerUploadHook(payload) : Promise.resolve({})); export const deleteFileAsset = async () => ({})`
        if (id === '\0file-picker-pagination') return `export const DEFAULT_PAGE_SIZE = 48; export const clampPage = () => 1; export default function PaginationControls() { return null }`
        return null
      },
    },
    react(),
  ],
})

try {
  const module = await vite.ssrLoadModule('/src/components/files/FilePickerModal.tsx') as { default: React.ComponentType<Record<string, unknown>> }
  const container = memoryDocument.createElement('div')
  memoryDocument.body.appendChild(container)
  const root = createRoot(container as unknown as Element)
  await act(async () => {
    root.render(React.createElement(module.default, { open: true, onClose() {}, title: 'Mounted file picker' }))
    await Promise.resolve()
  })
  const dialogs = memoryDocument.body.childNodes.filter((node) => node.getAttribute('role') === 'dialog')
  assert.equal(dialogs.length, 1, 'opening the picker must mount one shared dialog instead of crashing in the close guard')
  assert.match(memoryDocument.body.textContent, /Mounted file picker/)
  await act(async () => root.unmount())

  type PickerUpload = { signal: AbortSignal | undefined; resolve: (asset: unknown) => void }
  const uploads: PickerUpload[] = []
  const notes: Array<[string, string]> = []
  ;(globalThis as unknown as Record<string, unknown>).__pickerNotes = notes
  ;(globalThis as unknown as Record<string, unknown>).__pickerUploadHook = (payload: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
    uploads.push({ signal: payload.signal, resolve })
    payload.signal?.addEventListener('abort', () => reject(Object.assign(new Error('Upload cancelled'), { code: 'upload_cancelled' })))
  })
  const findFileInput = (node: MemoryNode): MemoryNode | null => {
    if (node.tagName === 'INPUT' && node.getAttribute('type') === 'file') return node
    for (const child of node.childNodes) {
      const found = findFileInput(child)
      if (found) return found
    }
    return null
  }
  const pickFiles = async (names: string[]) => {
    const input = findFileInput(memoryDocument.body)
    assert.ok(input, 'the picker has no file input')
    const propsKey = Object.keys(input).find((key) => key.startsWith('__reactProps$'))
    assert.ok(propsKey, 'the file input has no React props')
    const props = (input as unknown as Record<string, { onChange: (event: unknown) => unknown }>)[propsKey]
    await act(async () => {
      props.onChange({ target: { files: names.map((name) => new File([new Uint8Array(8)], name, { type: 'video/mp4' })), value: names[0] } })
      await Promise.resolve()
    })
  }
  const pickFile = (name: string) => pickFiles([name])
  const selected: string[] = []
  let closes = 0
  const pickerElement = (open: boolean) => React.createElement(module.default, {
    open,
    onClose() { closes += 1 },
    onSelect(path: string) { selected.push(path) },
    title: 'Upload picker',
  })
  const uploadRoot = createRoot(memoryDocument.createElement('div') as unknown as Element)
  await act(async () => { uploadRoot.render(pickerElement(true)); await Promise.resolve() })

  await pickFile('first.mp4')
  assert.equal(uploads.length, 1, 'picking a file should start one upload')
  assert.ok(uploads[0].signal, 'the upload was started without an abort signal: closing or a timeout could not stop it')
  assert.equal(uploads[0].signal?.aborted, false)

  await pickFile('second.mp4')
  assert.equal(uploads.length, 1, 'a second pick during an upload must be ignored until the first settles')

  await act(async () => { uploadRoot.render(pickerElement(false)); await Promise.resolve() })
  assert.equal(uploads[0].signal?.aborted, true, 'closing the picker must abort the request in flight')
  await act(async () => { await Promise.resolve() })
  assert.deepEqual(notes.filter(([, type]) => type === 'error'), [], 'an upload the person closed away must not raise an error toast')

  await act(async () => { uploadRoot.render(pickerElement(true)); await Promise.resolve() })
  await pickFile('third.mp4')
  assert.equal(uploads.length, 2, 'once the aborted upload settled the picker must accept a new one')
  assert.equal(uploads[1].signal?.aborted, false)
  await act(async () => { uploads[1].resolve({ public_path: '/uploads/third.mp4' }); await Promise.resolve() })
  assert.deepEqual(selected, ['/uploads/third.mp4'])
  assert.equal(closes, 1)

  await act(async () => { uploadRoot.render(pickerElement(true)); await Promise.resolve() })
  await pickFile('fourth.mp4')
  assert.equal(uploads.length, 3)
  await act(async () => uploadRoot.unmount())
  assert.equal(uploads[2].signal?.aborted, true, 'unmounting the picker must abort the request in flight')

  const outcomes: Record<string, 'ok' | 'big' | 'down'> = {}
  const attempted: string[] = []
  ;(globalThis as unknown as Record<string, unknown>).__pickerUploadHook = async (payload: { file: File }) => {
    attempted.push(payload.file.name)
    if (outcomes[payload.file.name] === 'big') throw Object.assign(new Error('This file is larger than 25 MB. Choose a smaller file.'), { code: 'upload_too_large' })
    if (outcomes[payload.file.name] === 'down') throw new Error('File upload failed. Check your server connection and try again.')
    return { public_path: '/uploads/' + payload.file.name }
  }
  const batchRoot = createRoot(memoryDocument.createElement('div') as unknown as Element)
  const batchElement = React.createElement(module.default, { open: true, multiple: true, onClose() { closes += 1 }, title: 'Batch picker' })
  await act(async () => { batchRoot.render(batchElement); await Promise.resolve() })
  const toasts = () => notes.map(([message, type]) => type + ': ' + message)

  notes.length = 0
  Object.assign(outcomes, { 'a.mp4': 'ok', 'big.mp4': 'big', 'c.mp4': 'ok' })
  await pickFiles(['a.mp4', 'big.mp4', 'c.mp4'])
  assert.deepEqual(attempted, ['a.mp4', 'big.mp4', 'c.mp4'], 'one oversized file ended the whole batch')
  assert.deepEqual(toasts(), ['error: big.mp4: This file is larger than 25 MB. Choose a smaller file.', 'success: Upload complete'])

  notes.length = 0
  attempted.length = 0
  Object.assign(outcomes, { 'big1.mp4': 'big', 'big2.mp4': 'big' })
  await pickFiles(['big1.mp4', 'big2.mp4'])
  assert.deepEqual(attempted, ['big1.mp4', 'big2.mp4'])
  assert.deepEqual(toasts(), [
    'error: big1.mp4: This file is larger than 25 MB. Choose a smaller file.',
    'error: big2.mp4: This file is larger than 25 MB. Choose a smaller file.',
  ], 'a batch where every file was refused for size must not announce an upload')

  notes.length = 0
  attempted.length = 0
  Object.assign(outcomes, { 'd.mp4': 'ok', 'offline.mp4': 'down', 'e.mp4': 'ok' })
  await pickFiles(['d.mp4', 'offline.mp4', 'e.mp4'])
  assert.deepEqual(attempted, ['d.mp4', 'offline.mp4'], 'a connection failure should still stop the batch')
  assert.deepEqual(toasts(), ['error: File upload failed. Check your server connection and try again.'])
  await act(async () => batchRoot.unmount())
} finally {
  await vite.close()
}

console.log('PASS mounted FilePickerModal declares its shared close-guard contract')
