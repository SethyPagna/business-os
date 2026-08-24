const fs = require('fs')
const path = require('path')

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations')

function loadAll() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  return files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

module.exports = { loadAll }
