import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'

const require = createRequire(import.meta.url)
const React = require('react')
const sourcePath = path.resolve(process.cwd(), 'src/components/shared/PaginationControls.tsx')
export const pagerSource = fs.readFileSync(sourcePath, 'utf8')

export function compactPager(props: Record<string, unknown>, source = pagerSource, onDraft = (_value: string) => {}) {
  const compiled = buildSync({ stdin: { contents: source, sourcefile: sourcePath, resolveDir: path.dirname(sourcePath), loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], write: false }).outputFiles[0].text
  const mod: any = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((id: string) => id === 'react' ? { ...React, useState: (initial: any) => [initial, onDraft], useEffect: () => {} } : require(id), mod, mod.exports)
  return mod.exports.default({ compact: true, page: 13, pageSize: 20, totalItems: 245, ...props })
}

export function hydrationScript(props: Record<string, unknown>, pack: Record<string, string>, source = pagerSource) {
  const entry = `${source}
import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
const fixtureProps = ${JSON.stringify(props)}, fixturePack = ${JSON.stringify(pack)};
function Fixture() {
  const [selected, select] = useState(fixtureProps.page);
  useEffect(() => { document.body.dataset.hydrated = 'true' }, []);
  return createElement(PaginationControls, {...fixtureProps, page:selected, onPageChange:select, t:key=>fixturePack[key]});
}
hydrateRoot(document.querySelector('[data-fixture]'), createElement(Fixture));`
  return buildSync({ stdin: { contents: entry, sourcefile: sourcePath, resolveDir: path.dirname(sourcePath), loader: 'tsx' }, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', write: false }).outputFiles[0].text
}

export const markup = (element: any): string => require('react-dom/server').renderToStaticMarkup(element)
export const elements = (element: any): any[] => Array.isArray(element) ? element.flatMap(elements) : React.isValidElement(element) ? [element, ...elements(element.props.children)] : []
export const language = (lang: string) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), `src/lang/${lang}.json`), 'utf8'))

// The prior constrained tracks and ellipsis are deliberately restored only
// inside this negative-control fixture, never in application code.
export const oldCompactLayout = () => pagerSource
  .replace('flex max-w-full flex-wrap items-center justify-between gap-1', 'grid max-w-full grid-cols-[minmax(5rem,1fr)_minmax(12rem,14rem)] items-center gap-1')
  .replace('inline-flex max-w-full flex-wrap items-center justify-center rounded-full border border-slate-200 bg-white', 'inline-flex min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white')
  .replace('shrink-0 whitespace-nowrap px-1 text-center text-[11px] font-semibold tabular-nums', 'min-w-0 flex-1 truncate px-1 text-center text-[11px] font-semibold')
  .replaceAll('gap-0.5 px-1 text-slate-500', 'gap-0.5 px-2 text-slate-500')
  .replace('<span aria-hidden="true">{safePage} / {totalPages}</span>', '<span aria-hidden="true">{pageLabel} {safePage} {ofLabel} {totalPages}</span>')
