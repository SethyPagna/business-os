import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/components/shared/PagerActionRow.tsx', import.meta.url), 'utf8')

assert.match(source, /grid-cols-\[2\.5rem_minmax\(0,1fr\)_2\.5rem\]/, 'equal 40px side tracks keep the pager on the page centreline')
assert.match(source, /!gap-0/, 'override the important global mobile grid gap so narrow Khmer pagers retain their full center-track width')
assert.equal((source.match(/w-10 min-w-0/g) || []).length, 2, 'missing or permission-hidden actions retain identical bounded slots')
assert.match(source, /justify-start/, 'Shift occupies the left edge of its slot')
assert.match(source, /justify-center">\{children\}/, 'the pager stays centered in the flexible middle track')
assert.match(source, /justify-end/, 'the page-specific action occupies the right edge of its slot')
assert.match(source, /children: ReactNode/, 'the centered pager is required')
assert.match(source, /leading\?: ReactNode/)
assert.match(source, /trailing\?: ReactNode/)

console.log('PASS shared pager action row keeps a true center with equal bounded side slots')
