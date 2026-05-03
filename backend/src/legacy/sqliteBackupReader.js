'use strict'

const Database = require('better-sqlite3')

function openReadonlySqliteDatabase(dbPath) {
  return new Database(dbPath, { readonly: true, fileMustExist: true })
}

module.exports = {
  openReadonlySqliteDatabase,
}
