import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path: string) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
const app = read('App.tsx')
const modal = read('components/shared/Modal.tsx')
const advisory = app.match(/const bottomStackClass[^\n]*z-\[(\d+)\]/)
assert.ok(advisory, 'read the actual shell advisory layer')
const advisoryLayer = Number(advisory[1])
const modalLayers = modal.match(/layer === 'nested' \? 'z-\[(\d+)\]' : 'z-\[(\d+)\]'/)
assert.ok(modalLayers, 'read both actual modal layers')
for (const layer of modalLayers.slice(1).map(Number)) {
  assert.ok(advisoryLayer < layer, 'persistent install/storage cards must not intercept modal Save or Next')
}
for (const path of ['components/shared/BackgroundImportTracker.tsx', 'components/shared/NotificationCenter.tsx']) {
  const layers = [...read(path).matchAll(/className=[^\n]*z-\[(\d+)\]/g)].map(match => Number(match[1]))
  assert.ok(layers.length > 0, `read live shell widget layers: ${path}`)
  assert.ok(layers.every(layer => layer < advisoryLayer), 'advisories remain above ordinary shell widgets')
}
assert.match(app, /const classes = `fixed[^\n]*z-\[1100\]/, 'action toasts retain their existing layer')
assert.match(app, /className="fixed inset-x-0 top-0 z-\[1500\]/, 'update/restart alert retains its existing layer')
assert.ok(Number(modalLayers[1]) < 1100 && advisoryLayer < 1100)
assert.match(app, /BOTTOM_STACK_CLEARS_NAV_CLASS = 'bottom-\[calc\(3\.55rem\+env\(safe-area-inset-bottom\)\)\]'/)
assert.match(app, /bottomStackClass\(BOTTOM_STACK_CLEARS_SAFE_AREA_CLASS\)/, 'login advisory uses the shared stack')
assert.match(app, /bottomStackClass\(inlineMobileNavigation \? BOTTOM_STACK_CLEARS_SAFE_AREA_CLASS : BOTTOM_STACK_CLEARS_NAV_CLASS\)/, 'signed-in advisory uses the shared stack')
assert.match(read('components/shared/InstallPromptBand.tsx'), /className="pointer-events-auto/, 'install controls remain usable outside dialogs')
console.log('PASS persistent advisories above shell widgets and below both modal layers; toast/update/nav and install controls retained')
