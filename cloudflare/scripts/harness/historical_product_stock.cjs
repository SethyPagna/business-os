const { loadAll } = require('./load_migrations.cjs')
const historicalMigrations = () => loadAll({ through: 241 })
function installCurrentStockGuards(raw) {
  if (raw.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='product_deactivate_stock_0242'").get()) return
  for (const sql of loadAll().slice(historicalMigrations().length)) raw.exec(sql)
}
module.exports = { historicalMigrations, installCurrentStockGuards }
