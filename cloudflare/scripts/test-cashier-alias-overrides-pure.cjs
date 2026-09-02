const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const db = new Database(':memory:')
const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0103_cashier_alias_overrides.sql'), 'utf8')

try {
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, name TEXT);
    CREATE TABLE user_aliases (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, alias TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_user_aliases_alias ON user_aliases(lower(trim(alias)));
    CREATE TABLE legacy_deleted_sale_items (id INTEGER PRIMARY KEY, cashier_name TEXT, cashier_id INTEGER);
    INSERT INTO users (id,username,name) VALUES
      (1,'admin','Admin'),(2,'james','Ung Sethy Pagna'),(3,'Za','Oun Raksa'),
      (4,'Rath','Roune Rath'),(5,'sethyka','UNG Sethyka');
    INSERT INTO user_aliases (user_id,alias) VALUES (5,'sethyka'),(4,'routh'),(3,'aza');
    INSERT INTO legacy_deleted_sale_items (id,cashier_name,cashier_id) VALUES
      (1,'sethyka',5),(2,'sethyka',5),(3,'Rath',4);
  `)

  db.exec(migration)
  const aliases = Object.fromEntries(db.prepare('SELECT lower(trim(alias)) alias,user_id FROM user_aliases').all().map((row) => [row.alias, row.user_id]))
  assert.deepEqual(aliases, {
    aza: 3,
    rout: 4,
    routh: 4,
    sethyka: 2,
    pagna: 2,
    'super admin': 1,
    'dev-usmart': 1,
  })
  assert.deepEqual(db.prepare('SELECT cashier_name,cashier_id,COUNT(*) n FROM legacy_deleted_sale_items GROUP BY cashier_name,cashier_id ORDER BY cashier_id').all(), [
    { cashier_name: 'james', cashier_id: 2, n: 2 },
    { cashier_name: 'Rath', cashier_id: 4, n: 1 },
  ])

  db.exec(migration)
  assert.equal(db.prepare('SELECT COUNT(*) FROM user_aliases').pluck().get(), 7, 'migration rerun stays idempotent')
  assert.equal(db.prepare("SELECT COUNT(*) FROM legacy_deleted_sale_items WHERE cashier_name='james' AND cashier_id=2").pluck().get(), 2)
  console.log('PASS canonical cashier aliases override stale direct usernames and backfill deterministically')
} finally {
  db.close()
}
