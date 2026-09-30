// The Scanbot Web SDK (27.9 MB of wasm and js) was shipped in public/ but no
// code path ever loaded it: the scanner modal decodes with the native
// BarcodeDetector and falls back to ZXing. This pins that the SDK, its loader
// and every reference to it stay gone, and that the real decoders stay wired.
//
// Run: node tests/noScanbotSdk.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(import.meta.dirname, '..')
const REPO = path.join(ROOT, '..')
const TEXT_EXT = /\.(ts|tsx|js|cjs|mjs|json|html|css|txt|toml|md)$/i

function collect(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, out)
    else if (TEXT_EXT.test(entry.name)) out.push(full)
  }
  return out
}

const rel = (file: string): string => path.relative(REPO, file).split(path.sep).join('/')

// A wasm bundle the app never loads is dead weight on every deploy; if the
// folder came back, every release would upload 27.9 MB again.
assert.equal(fs.existsSync(path.join(ROOT, 'public', 'scanbot-web-sdk')), false, 'public/scanbot-web-sdk must not ship')

// Reference sweep across app source, static assets, page shell, build config and the Worker.
const roots = [
  path.join(ROOT, 'src'),
  path.join(ROOT, 'public'),
  path.join(REPO, 'cloudflare', 'src'),
  path.join(REPO, 'ops', 'scripts'),
]
const files = [
  ...roots.flatMap((dir) => collect(dir)),
  path.join(ROOT, 'index.html'),
  path.join(ROOT, 'package.json'),
  path.join(REPO, 'cloudflare', 'wrangler.toml'),
  path.join(REPO, '.gitignore'),
].filter((file) => fs.existsSync(file))
const hits = files.filter((file) => /scanbot/i.test(fs.readFileSync(file, 'utf8'))).map(rel)
assert.deepEqual(hits, [], `no file may still mention the Scanbot SDK: ${hits.join(', ')}`)

// The scanner that does work must stay: native BarcodeDetector first, ZXing second,
// and the camera policy check now lives in cameraPolicy.ts.
const modal = fs.readFileSync(path.join(ROOT, 'src/components/products/scanning/BarcodeScannerModal.tsx'), 'utf8')
assert.ok(modal.includes('BarcodeDetector'), 'modal keeps the native BarcodeDetector path')
assert.ok(modal.includes('BrowserMultiFormatReader'), 'modal keeps the ZXing fallback')
assert.ok(modal.includes("from './cameraPolicy.ts'"), 'modal imports the camera policy check from cameraPolicy.ts')
assert.ok(
  fs.readFileSync(path.join(ROOT, 'src/components/products/scanning/cameraPolicy.ts'), 'utf8').includes('export function isCameraBlockedByDocumentPolicy'),
  'cameraPolicy.ts exports isCameraBlockedByDocumentPolicy',
)

console.log('noScanbotSdk tests passed')
