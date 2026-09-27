const fs = require('fs')
const path = require('path')

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations')

// `through`: stop after that migration number, for a test that replays an
// old migration against the schema it actually ran on (a later trigger, e.g.
// 0195's catalog-cost triggers, would otherwise rewrite the seeded fixture).
function loadAll({ through } = {}) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    .filter((f) => through == null || Number(f.slice(0, 4)) <= through)
  return files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

module.exports = { loadAll }
