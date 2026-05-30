'use strict'

const assert = require('node:assert/strict')
const { attachWss } = require('../src/websocket.ts')

assert.equal(typeof attachWss, 'function')
assert.equal(attachWss.length, 1)
console.log('PASS websocket module exposes the attachWss server hook')
