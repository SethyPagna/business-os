import assert from 'node:assert/strict'
import { containsKhmerScript, getKhmerTextProps, withKhmerTextClass } from '../src/utils/scriptTypography.ts'

assert.equal(containsKhmerScript('Serum'), false)
assert.equal(containsKhmerScript('\u1780\u17D2\u179A\u17C1\u1798'), true)
assert.equal(containsKhmerScript(null), false)

assert.equal(withKhmerTextClass('\u1780\u17D2\u179A\u17C1\u1798', 'text-sm'), 'text-sm khmer-text')
assert.equal(withKhmerTextClass('\u1780\u17D2\u179A\u17C1\u1798'), 'khmer-text')
assert.equal(withKhmerTextClass('Serum', 'text-sm'), 'text-sm')

assert.deepEqual(getKhmerTextProps('Serum', 'text-sm'), { className: 'text-sm' })
assert.deepEqual(getKhmerTextProps('Serum'), {})
assert.deepEqual(getKhmerTextProps('\u1780\u17D2\u179A\u17C1\u1798', 'text-sm'), { lang: 'km', className: 'text-sm khmer-text' })

console.log('PASS script typography helpers detect Khmer and merge text props')
