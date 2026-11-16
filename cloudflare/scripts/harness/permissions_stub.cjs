// A stub of src/lib/permissions.ts for tests that load a route which imports it (routes/users.ts and others).
//
// A hand-written stub object (`{ isAdminControlUser: ... }`) goes stale the moment a route starts importing one more helper from the module:
// routes/users.ts began calling normalizePermissionMap on every role and user save (6.0.2319), and every test whose stub lacked it died with
// "(0 , permissions_1.normalizePermissionMap) is not a function" the first time it reached a save path. permissionsWith() returns the REAL module
// (it is pure: it imports nothing) with only the named functions replaced, so a new export is there for every test without editing any of them.
//
// Usage:  '../lib/permissions': require('./harness/permissions_stub.cjs').permissionsWith({ isAdminControlUser: (u) => u?.isAdmin === true }),
// test-users-route-permissions-stub-pure.cjs fails any test that loads routes/users.ts with a bare-object stub instead.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const SOURCE = path.join(__dirname, '..', '..', 'src', 'lib', 'permissions.ts')
let real = null

function realPermissions() {
  if (real) return real
  const { outputText } = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: SOURCE,
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, SOURCE, path.dirname(SOURCE))
  real = moduleObj.exports
  return real
}

/** The real permissions module with `overrides` laid over it (a fresh object each call, so one test's override never leaks into another). */
function permissionsWith(overrides = {}) {
  return { ...realPermissions(), ...overrides }
}

module.exports = { permissionsWith }
