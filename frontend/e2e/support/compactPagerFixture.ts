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
  new Function('require', 'module', 'exports', compiled)((id: string) => id === 'react' ? { ...React, useState: (initial: any) => [initial, onDraft], useEffect: () => {}, useContext: (context: any) => context._currentValue } : require(id), mod, mod.exports)
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
  // The compact pill is now one row (Back, range of total, page / pages, Next). The negative control
  // restores what hid the Khmer page total at 320px: a width-capped pill whose text is truncated.
  .replace('mx-auto flex w-fit max-w-full items-center justify-center rounded-full border border-slate-200 bg-white', 'inline-flex w-28 min-w-0 items-center overflow-hidden rounded-full border border-slate-200 bg-white')
  .replace("<span data-pager-range className={`shrink-0 whitespace-nowrap rounded-full bg-slate-50 ${dense ? 'px-1' : 'px-1.5'} py-1 ${textSize} font-semibold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-100`}>", '<span data-pager-range className="min-w-0 flex-1 truncate rounded-full bg-slate-50 px-1.5 py-1 text-[11px] font-semibold tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-100">')
  .replace("<span data-pager-page className={`shrink-0 whitespace-nowrap ${edgePad} text-center ${textSize} font-semibold tabular-nums text-slate-700 dark:text-slate-100`}>", '<span data-pager-page className="min-w-0 flex-1 truncate px-1 text-center text-[11px] font-semibold">')
  .replace('<span aria-hidden="true">{safePage} / {totalPages}</span>', '<span aria-hidden="true">{pageLabel} {safePage} {ofLabel} {totalPages}</span>')
