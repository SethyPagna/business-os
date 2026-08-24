import assert from 'node:assert/strict'
import { parseProductDescription } from '../src/components/catalog/productDetailSections.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('parseProductDescription treats a plain description with no labels as intro-only', () => {
  const result = parseProductDescription('Just a normal product description, nothing special.')
  assert.equal(result.hasStructuredSections, false)
  assert.equal(result.sections.length, 0)
  assert.equal(result.intro, 'Just a normal product description, nothing special.')
})

await runTest('parseProductDescription returns empty shape for null/undefined/blank input', () => {
  for (const input of [null, undefined, '', '   ']) {
    const result = parseProductDescription(input as string | null | undefined)
    assert.equal(result.hasStructuredSections, false)
    assert.equal(result.sections.length, 0)
    assert.equal(result.intro, '')
  }
})

await runTest('parseProductDescription splits multi-line labeled sections into bullets, in source order', () => {
  const description = [
    'A gentle daily moisturizer.',
    '',
    'Features:',
    'Lightweight gel texture',
    'Fragrance-free',
    '',
    'Benefits:',
    'Hydrates without clogging pores',
    'Suitable for sensitive skin',
  ].join('\n')
  const result = parseProductDescription(description)
  assert.equal(result.hasStructuredSections, true)
  assert.equal(result.intro, 'A gentle daily moisturizer.')
  assert.deepEqual(result.sections.map((s) => s.key), ['features', 'benefits'])
  assert.deepEqual(result.sections[0].items, ['Lightweight gel texture', 'Fragrance-free'])
  assert.deepEqual(result.sections[1].items, ['Hydrates without clogging pores', 'Suitable for sensitive skin'])
})

await runTest('parseProductDescription recognizes labels case-insensitively with a dash separator', () => {
  const result = parseProductDescription('caution - Patch test before first use')
  assert.equal(result.hasStructuredSections, true)
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].key, 'caution')
  assert.deepEqual(result.sections[0].items, ['Patch test before first use'])
})

await runTest('parseProductDescription splits a single-line section on explicit bullet separators', () => {
  const result = parseProductDescription('Ingredients: Water • Glycerin • Niacinamide')
  assert.equal(result.sections.length, 1)
  assert.equal(result.sections[0].key, 'ingredients')
  assert.deepEqual(result.sections[0].items, ['Water', 'Glycerin', 'Niacinamide'])
})

await runTest('parseProductDescription keeps a single-line section with no separators as one plain item', () => {
  const result = parseProductDescription('Caution: Keep out of reach of children.')
  assert.equal(result.sections.length, 1)
  assert.deepEqual(result.sections[0].items, ['Keep out of reach of children.'])
})

process.exit(failed ? 1 : 0)
