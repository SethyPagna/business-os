// Read-only deterministic probe against the actual transpiled module.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const ts = require(path.join(root, 'cloudflare/node_modules/typescript'));
const source = fs.readFileSync(path.join(root, 'cloudflare/src/lib/queueDispatch.ts'), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(output, { module: moduleObject, exports: moduleObject.exports, require, console });
const { registerInlineImportRunner, dispatchImportWork } = moduleObject.exports;
let releaseA;
const barrier = new Promise(resolve => { releaseA = resolve; });
const ran = [];
registerInlineImportRunner(async (_env, message) => {
  ran.push(message.jobId);
  if (message.jobId === 'A') { await barrier; throw new Error('A fails'); }
});
(async () => {
  const resultA = dispatchImportWork({}, { jobId: 'A', kind: 'analyze' }).catch(error => error.message);
  const resultB = await dispatchImportWork({}, { jobId: 'B', kind: 'analyze' });
  assert.equal(resultB, 'inline');
  assert.deepEqual(ran, ['A']);
  releaseA();
  assert.equal(await resultA, 'A fails');
  await dispatchImportWork({}, { jobId: 'C', kind: 'analyze' });
  assert.deepEqual(ran, ['A', 'C']);
  console.log('REPRODUCED: independent B dispatch resolved inline before execution; failure of A discarded B; C ran without B.');
})().catch(error => { console.error(error); process.exitCode = 1; });
