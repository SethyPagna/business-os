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
        if (id === '\0file-picker-app-context') return `export const useApp = () => ({ notify() {}, user: null, t: (key) => key })`
        if (id === '\0file-picker-transport') return `export const getFiles = async () => ({ items: [], total: 0 }); export const uploadFileAsset = async () => ({}); export const deleteFileAsset = async () => ({})`
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
} finally {
  await vite.close()
}

console.log('PASS mounted FilePickerModal declares its shared close-guard contract')
