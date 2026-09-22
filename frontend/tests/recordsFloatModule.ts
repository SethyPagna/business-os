// Compiles components/shared/RecordsFloat.tsx so a test can render the REAL
// float and the REAL change table.
//
// Not a test itself (no .test suffix, so the runner skips it). It exists
// because four surfaces now share one float: the sale's rendered contract, the
// return's, the product's and the contact's all have to be pinned against the
// same component, and a per-test copy of this loader is how one of them
// quietly ends up pinning a stub instead.
//
// Only the leaves are stubbed -- the icons, the date formatter, and the Modal /
// FilterMenu chrome, which are pass-through shells here so the float's own
// content is what gets rendered and asserted on. entityRecords is the real
// module: the adapters, the value states and the audit diff are exactly what
// is under test.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')

export function loadRecordsFloatModule(): Record<string, unknown> {
  const source = readFileSync(new URL('../src/components/shared/RecordsFloat.tsx', import.meta.url), 'utf8')
  const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as Record<string, unknown> }
  new Function('require', 'module', 'exports', compiled)((id: string) => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id)
    if (id.includes('utils/entityRecords')) return require('../src/utils/entityRecords.ts')
    if (id.includes('utils/formatters')) return { fmtDateTime24: () => '08/09/2026 12:00' }
    if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
    return { __esModule: true, default: ({ children }: { children?: unknown }) => React.createElement(React.Fragment, null, children) }
  }, mod, mod.exports)
  return mod.exports
}
