import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P4-4b fix 2: the POS product grid renders ProductCard 20-50+ times per
// page and re-renders on every cart/keyboard change unrelated to the
// catalogue. React.memo on ProductCard only pays off if every prop stays
// referentially stable across those unrelated renders -- otherwise it is
// exactly the "memo that never memoizes" bloat this fix must avoid. This
// test pins all three parts of that chain: the memo boundary itself, the
// stable-handler cache in POS.tsx that stopped minting a new
// onOpen/onOpenImage closure per row per render, and posCore.ts no longer
// handing out a fresh `[]` for "no variants" on every call.
//
// No DOM renderer is available in this harness (no react-dom/test-utils or
// testing-library devDependency), so this is a source-assertion test in the
// project's existing style (see tests/actionStability.test.ts).

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const productCard = readFrontend('src/components/pos/ProductCard.tsx')
const posCore = readFrontend('src/components/pos/posCore.ts')
const pos = readFrontend('src/components/pos/POS.tsx')

runTest('ProductCard is wrapped in React.memo', () => {
  assert.match(productCard, /import \{ memo \} from 'react'/, 'ProductCard.tsx must import memo from react')
  assert.match(productCard, /const ProductCard = memo\(ProductCardComponent\)/, 'default export must be the memoized component')
  assert.match(productCard, /^export default ProductCard$/m, 'memoized ProductCard must be the default export')
  // Positive control: the pre-fix code exported the component function
  // directly with no memo boundary at all.
  assert.doesNotMatch(productCard, /^export default function ProductCard\(\{/m, 'the pre-fix unmemoized direct export must be gone')
})

runTest('getVariantChoices returns a shared stable empty array, not a fresh literal', () => {
  assert.match(posCore, /const NO_VARIANT_CHOICES: ProductRecord\[\] = Object\.freeze\(\[\] as ProductRecord\[\]\)/, 'a shared frozen empty-array constant must exist')
  assert.match(posCore, /variantChildrenByParentId\.get\(rootId\) \|\| NO_VARIANT_CHOICES/, 'the no-match branch must return the shared constant')
  // Positive control: the pre-fix code built a brand-new `[]` on every call
  // with no match, which broke ProductCard's memo for every standalone
  // (non-grouped) product.
  assert.doesNotMatch(posCore, /variantChildrenByParentId\.get\(rootId\) \|\| \[\]/, 'the pre-fix per-call empty-array literal must be gone')
})

runTest('POS.tsx caches per-product onOpen/onOpenImage handlers instead of minting them per render', () => {
  assert.match(pos, /const productCardHandlersRef = useRef\(new Map</, 'a per-product-id handler cache must exist')
  assert.match(pos, /const getProductCardHandlers = useCallback\(\(p: ProductRecord\) => \{/, 'a stable accessor for the cached handlers must exist')
  assert.match(pos, /onOpen=\{handlers\.onOpen\}/, 'the card must receive the cached onOpen handler')
  assert.match(pos, /onOpenImage=\{handlers\.onOpenImage\}/, 'the card must receive the cached onOpenImage handler')
  // Positive control: the pre-fix JSX built a fresh arrow function closing
  // over `p` on every render of every row -- defeating any memo on
  // ProductCard because at least one prop always differed.
  assert.doesNotMatch(pos, /onOpen=\{\(options\) => openProductCard\(p, options\)\}/, 'the pre-fix per-render inline onOpen closure must be gone')
  assert.doesNotMatch(pos, /onOpenImage=\{\(\) => openImageLightbox\(p, 0\)\}/, 'the pre-fix per-render inline onOpenImage closure must be gone')
})

runTest('POS.tsx hoists getStock to one stable callback instead of a fresh arrow function per row', () => {
  assert.match(pos, /const getPosCardStock = useCallback\(\(row: ProductCardProduct\) => getDisplayStock\(row as ProductRecord\), \[getDisplayStock\]\)/, 'getPosCardStock must be a single memoized callback')
  assert.match(pos, /getStock=\{getPosCardStock\}/, 'the card must receive the stable getStock callback')
  assert.doesNotMatch(pos, /getStock=\{\(row\) => getDisplayStock\(row as ProductRecord\)\}/, 'the pre-fix per-render inline getStock closure must be gone')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All hotRowMemoBoundaries tests passed')
}
