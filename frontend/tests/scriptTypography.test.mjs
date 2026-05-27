import assert from 'node:assert/strict'
import { containsKhmerScript, getKhmerTextProps, withKhmerTextClass } from '../src/utils/scriptTypography.js'

assert.equal(containsKhmerScript('Serum'), false)
assert.equal(containsKhmerScript('ក្រែម'), true)
assert.equal(containsKhmerScript(null), false)

assert.equal(withKhmerTextClass('ក្រែម', 'text-sm'), 'text-sm khmer-text')
assert.equal(withKhmerTextClass('ក្រែម'), 'khmer-text')
assert.equal(withKhmerTextClass('Serum', 'text-sm'), 'text-sm')

assert.deepEqual(getKhmerTextProps('Serum', 'text-sm'), { className: 'text-sm' })
assert.deepEqual(getKhmerTextProps('Serum'), {})
assert.deepEqual(getKhmerTextProps('ក្រែម', 'text-sm'), { lang: 'km', className: 'text-sm khmer-text' })

console.log('PASS script typography helpers detect Khmer and merge text props')
