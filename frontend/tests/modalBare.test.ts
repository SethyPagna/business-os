import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { createHarness, propsOf } from './mountedComponentHarness.ts'
import type { MemoryNode } from './mountedComponentHarness.ts'

// The camera sheet draws its own close button over the video, so the shared Modal
// gained an opt-in `bare` mode: no header row, no body padding, the title kept as the
// dialog's screen-reader name. Everything else about the Modal is as it was: the
// default modal keeps its header and its translated, 44 px Close.

const words = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const probe = createElement('button', { type: 'button', 'aria-label': 'Inside' })

const harness = await createHarness()
try {
  const mount = (props: Record<string, unknown>) => harness.mount({
    component: 'components/shared/Modal.tsx',
    props: { title: 'Scan barcode', onClose() {}, unsavedChanges: 'read-only', children: probe, ...props },
    app: { t: (key: string) => words[key] || key },
    doubles: {},
  })
  const all = (surface: Awaited<ReturnType<typeof mount>>, test: (node: MemoryNode) => boolean) => surface.findAll(test)

  const bare = await mount({ bare: true })
  const bareClose = all(bare, (node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.close)
  assert.equal(bareClose.length, 0, 'bare: the header Close is not drawn; the content supplies its own')
  const bareTitle = all(bare, (node) => node.tagName === 'H2')
  assert.equal(bareTitle.length, 1, 'bare: the title is still there for the dialog name')
  assert.match(String(propsOf(bareTitle[0]).className), /\bsr-only\b/, 'bare: and is visually hidden')
  assert.equal(bareTitle[0].textContent, 'Scan barcode')
  const dialog = all(bare, (node) => node.getAttribute('role') === 'dialog')[0]
  assert.equal(dialog.getAttribute('aria-labelledby'), bareTitle[0].getAttribute('id'), 'bare: the dialog is still named by that title')
  const body = all(bare, (node) => /\bmodal-scroll\b/.test(String(propsOf(node).className ?? '')))[0]
  assert.doesNotMatch(String(propsOf(body).className), /\bp-3\b|\bsm:p-4\b/, 'bare: no padding round the content')
  assert.equal(all(bare, (node) => node.getAttribute('aria-label') === 'Inside').length, 1, 'bare: the content renders')
  const panel = all(bare, (node) => /\bmodal-panel-safe\b/.test(String(propsOf(node).className ?? '')))[0]
  assert.match(String(propsOf(panel).className), /\boverflow-hidden\b/, 'bare: the rounded panel clips a full-bleed video')
  await bare.unmount()

  const normal = await mount({})
  assert.equal(all(normal, (node) => node.tagName === 'BUTTON' && node.getAttribute('aria-label') === words.close).length, 1, 'default: the header Close is still there')
  const normalBody = all(normal, (node) => /\bmodal-scroll\b/.test(String(propsOf(node).className ?? '')))[0]
  assert.match(String(propsOf(normalBody).className), /\bp-3\b/, 'default: the body keeps its padding')
  const normalPanel = all(normal, (node) => /\bmodal-panel-safe\b/.test(String(propsOf(node).className ?? '')))[0]
  assert.doesNotMatch(String(propsOf(normalPanel).className), /\boverflow-hidden\b/, 'default: the panel is as it was')
  await normal.unmount()

  console.log('PASS the shared Modal draws no header in bare mode (title kept for the dialog name) and is unchanged by default')
} finally {
  await harness.close()
}
