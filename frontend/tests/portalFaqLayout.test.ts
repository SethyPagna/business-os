// Owner, 2026-09-25 (P-public-4): "FAQ: only the clicked item expands;
// neighbours don't stretch."
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { faqItemKey, nextOpenFaqKey, splitFaqColumns } from '../src/components/catalog/portalFaqLayout.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.join(here, '..', relative), 'utf8').replace(/\r\n/g, '\n')

// Saved FAQ data as the storefront receives it: nothing on the storefront or
// the Worker de-duplicates ids, so two items can share one. With id-keyed
// state (the old code) opening "faq-2" opened BOTH items below.
const items = [
  { id: 'faq-1', question: 'Delivery?', answer: 'Yes.' },
  { id: 'faq-2', question: 'Returns?', answer: '7 days.' },
  { id: 'faq-2', question: 'Payment?', answer: 'ABA, cash.' },
  { id: 'faq-4', question: 'Authentic?', answer: 'Always.' },
  { id: '', question: 'Samples?', answer: 'Ask us.' },
]

// 1. Independent expansion: clicking one opens exactly that one, whatever
//    the ids look like.
const [left, right] = splitFaqColumns(items)
const all = [...left, ...right]
const keys = all.map((entry) => entry.key)
assert.equal(new Set(keys).size, items.length, 'every FAQ item has its own open key, even with duplicate or empty ids')
let open: string | null = null
open = nextOpenFaqKey(open, all[1].key)
assert.deepEqual(all.filter((entry) => entry.key === open).map((entry) => entry.item.question), ['Returns?'], 'only the clicked item is open')
assert.ok(!all.some((entry) => entry.item.question === 'Payment?' && entry.key === open), 'the item sharing its id stays closed')
open = nextOpenFaqKey(open, all[2].key)
assert.deepEqual(all.filter((entry) => entry.key === open).map((entry) => entry.item.question), ['Payment?'], 'opening another closes the first')
open = nextOpenFaqKey(open, all[2].key)
assert.equal(open, null, 'clicking the open item again closes it')
// Negative control: the id-keyed rule this replaced opens two at once here.
assert.equal(items.filter((item) => item.id === items[1].id).length, 2, 'fixture must contain a shared id')
assert.equal(faqItemKey(items[1], 1) === faqItemKey(items[2], 2), false)

// 2. Neighbours do not move: two column stacks, first half / second half, so
//    DOM order stays 1..n whether the stacks sit side by side or stack.
assert.deepEqual(left.map((entry) => entry.index), [0, 1, 2])
assert.deepEqual(right.map((entry) => entry.index), [3, 4])
assert.deepEqual(splitFaqColumns([]), [[], []])
assert.deepEqual(splitFaqColumns([{ id: 'a' }]).map((column) => column.length), [1, 0])

// 3. The section uses both, with no shared row grid left.
const tabs = read('src/components/catalog/CatalogSecondaryTabs.tsx')
const section = tabs.slice(tabs.indexOf('function CatalogFaqSection'), tabs.indexOf('function CatalogAiSection'))
assert.match(section, /const faqColumns = splitFaqColumns\(publicFaqItems\)/)
assert.match(section, /const open = expandedFaqId === key/)
assert.match(section, /setExpandedFaqId\(\(current\) => nextOpenFaqKey\(current, key\)\)/)
assert.match(section, /aria-expanded=\{open\}/, 'the toggle announces its state')
assert.doesNotMatch(section, /grid items-start gap-4 sm:grid-cols-2|expandedFaqId === item\.id/, 'the shared-row grid / id-keyed state is back')

console.log('PASS FAQ items expand independently and never move the other column')
