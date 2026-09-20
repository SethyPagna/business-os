import assert from 'node:assert/strict'
import test from 'node:test'
import { compactPager, elements, language, markup } from '../e2e/support/compactPagerFixture.ts'

for (const lang of ['en', 'km']) {
  test(`plain compact ${lang} preserves complete page labels and numeric values`, () => {
    const pack = language(lang)
    for (const page of [13, 123456]) {
      const tree = compactPager({ page, totalItems: page * 20, t: (key: string) => pack[key] })
      const html = markup(tree)
      assert.match(html, new RegExp(`${page} / ${page}`))
      assert.ok(html.includes(`${pack.page} ${page} ${pack.of} ${page}`))
      assert.doesNotMatch(html, /truncate|text-ellipsis/)
      const buttons = elements(tree).filter((node) => node.type === 'button')
      assert.deepEqual(buttons.map((node) => node.props['aria-label']), [pack.back, pack.next])
      assert.equal(buttons[0].props.disabled, false)
      assert.equal(buttons[1].props.disabled, true)
    }
  })
}

test('plain compact actions and dynamically sized page input retain their contracts', () => {
  const changes: number[] = []
  const buttons = elements(compactPager({ page: 2, onPageChange: (page: number) => changes.push(page) })).filter((node) => node.type === 'button')
  buttons[0].props.onClick(); buttons[1].props.onClick()
  assert.deepEqual(changes, [1, 3])
  const first = elements(compactPager({ page: 1 })).find((node) => node.type === 'button')
  assert.equal(first.props.disabled, true)
  const input = elements(compactPager({ page: 123456, totalItems: 2469120, compactPageInput: true })).find((node) => node.type === 'input')
  assert.equal(input.props.value, '123456')
  assert.equal(input.props.style.width, 'max(2.25rem, calc(6ch + 0.5rem))')
  assert.equal(input.props['aria-label'], 'Page')
})
