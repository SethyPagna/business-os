// Shared test plumbing for the two bulk-change reviews (BulkSaleChangeModal,
// ReturnsBulkActionModal). Both are thin wrappers over the shared
// BulkFieldChangeDialog, which sits on the shared Modal -- so a test that
// renders a wrapper to static markup has to compile the real dialog and stand
// the portal-and-hook chrome (Modal), the hint and the search box in.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'

const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const here = path.dirname(fileURLToPath(import.meta.url))

export const NOT_BULK_DIALOG_DEPENDENCY = Symbol('not a bulk dialog dependency')

/** Resolves the dialog's own imports; anything else comes back as NOT_BULK_DIALOG_DEPENDENCY. */
export function bulkDialogDependency(id: string, shim: (id: string) => unknown): unknown {
  if (id.endsWith('BulkFieldChangeDialog.tsx')) {
    const source = readFileSync(path.join(here, '..', 'src', 'components', 'shared', 'BulkFieldChangeDialog.tsx'), 'utf8')
    const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
    const mod = { exports: {} as Record<string, unknown> }
    new Function('require', 'module', 'exports', compiled)(shim, mod, mod.exports)
    return mod.exports
  }
  // The Modal's title, header actions and body are what a person reads; its chrome is not under test here.
  if (id.endsWith('/Modal.tsx')) {
    return { __esModule: true, default: ({ title, headerExtra, children }: { title: unknown; headerExtra?: unknown; children?: unknown }) => React.createElement('div', { 'data-modal': '' }, title, headerExtra, children) }
  }
  if (id.endsWith('/InfoHint.tsx') || id.endsWith('/SearchInput.tsx')) return { __esModule: true, default: () => null }
  return NOT_BULK_DIALOG_DEPENDENCY
}
