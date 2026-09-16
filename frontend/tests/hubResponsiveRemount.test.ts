import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'

// Execute the real component with inert context/effects. Pin React's keyed
// reconciliation identity across every chrome branch; browser resize evidence
// additionally exercises real mounted report state.
const require = createRequire(import.meta.url)
const React = require('react')
let compact = true
let mode = 'pages'
const source = fs.readFileSync(new URL('../src/components/shared/HubSectionNav.tsx', import.meta.url), 'utf8')
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
const module = { exports: {} as { default?: (props: unknown) => any } }
const load = (id: string) => {
  if (id === 'react') return { ...React, useEffect: () => {} }
  if (id === 'react/jsx-runtime') return require(id)
  if (id.includes('AppContextCore')) return { useApp: () => ({ settings: {}, page: 'sales' }) }
  // useLayeredSectionNav is the shared "the compact home sheet owns section
  // switching" decision (utils/sectionNavPreference.ts) that HubSectionNav
  // and Products both read; its own composition is pinned in
  // hubSectionNav.test.ts, here the two inputs are driven directly.
  if (id.includes('sectionNavPreference')) return { useMobileSectionNavMode: () => mode, useLayeredSectionNav: () => compact && mode === 'pages' }
  if (id.includes('hubNavigation')) return { sealRootHubSection: () => {} }
  // Vite resolves a component's `import './x.css'` to a side-effect module
  // with no exports; it contributes nothing to the tree this test measures,
  // so it stays inert here instead of reading as an unexpected dependency.
  // Only a stylesheet passes: a real module still cannot slip the whitelist.
  if (id.endsWith('.css')) return {}
  throw new Error(`Unexpected dependency ${id}`)
}
new Function('require', 'module', 'exports', compiled)(load, module, module.exports)
const Hub = module.exports.default!
const child = React.createElement('section', { 'data-dirty-report': true })
let changes = 0
const props = { sections: [{ id: 'reports', label: 'Reports' }, { id: 'sales', label: 'Sales' }], active: 'reports', onChange: () => { changes++ }, children: child }
for (const testCase of [
  { compact: true, mode: 'pages', chrome: false },
  { compact: false, mode: 'pages', chrome: true },
  { compact: true, mode: 'sections', chrome: true },
  // `custom` no longer names a branch: the desktopNavigation escape hatch
  // is gone, so a host that still passes one gets the SHARED row anyway.
  { compact: false, mode: 'sections', chrome: true, custom: true },
  { compact: false, mode: 'pages', chrome: false, single: true },
  { compact: true, mode: 'pages', chrome: false },
]) {
  compact = testCase.compact; mode = testCase.mode
  const tree = Hub({ ...props, sections: testCase.single ? props.sections.slice(0, 1) : props.sections, desktopNavigation: testCase.custom ? React.createElement('nav') : undefined })
  const nodes = React.Children.toArray(tree.props.children)
  const content = nodes.find((node: any) => node.type === React.Fragment && node.props.children === child)
  assert.ok(content, 'content must always have a keyed Fragment, not shift as an unkeyed child')
  assert.equal(content.key, '.$hub-content', 'same content identity at 320/1440 and both navigation modes')
  assert.equal(nodes.length, testCase.chrome ? 2 : 1, 'chrome appears only in the modes that show a chip row')
  assert.equal(nodes.filter((node: any) => node.type === 'nav').length, 0,
    'a host cannot inject its own desktop chip row and bypass the shared one')
}
// Positive control for the whitelist itself. It is a WHITELIST -- an id it
// does not name has to fail loudly, or "no unexpected dependency" would be a
// property of this harness rather than of the component. useViewport is the
// case that proves it: HubSectionNav no longer imports it (the compact-vs-
// desktop hook existed only for the desktopNavigation escape hatch), so its
// stub is gone and asking for it now throws.
assert.throws(() => load('../../utils/useViewport.ts'), /Unexpected dependency/,
  'a real module id the whitelist does not name still stops the harness')
assert.throws(() => load('react-dom'), /Unexpected dependency/,
  'and so does one that was never stubbed at all')
assert.equal(changes, 0, 'viewport renders must not invoke navigation or dirty Back callbacks')
console.log('PASS hub responsive content identity across pages/legacy/custom/single-section branches')
