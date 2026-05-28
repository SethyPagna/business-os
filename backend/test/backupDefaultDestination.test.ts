'use strict'

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const source = fs.readFileSync(path.resolve(__dirname, '../src/routes/system/index.js'), 'utf8')

assert.match(source, /function\s+getDefaultBackupDestinationDir\s*\(/)
assert.match(source, /BUSINESS_OS_BACKUP_DIR/)
assert.match(source, /path\.resolve\(STORAGE_ROOT,\s*'backups'\)/)
assert.match(source, /destinationDir\s*=\s*String\(req\.body\?\.destinationDir\s*\|\|\s*''\)\.trim\(\)\s*\|\|\s*getDefaultBackupDestinationDir\(\)/)

console.log('PASS backup export has a safe default destination')
