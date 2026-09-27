import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGES, USAGE, parseVerifyArgs, planVerify, quoteTerms, restoreLineEndingOnlyChanges, runStep, summarizeVerify } from "./verify-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const request = parseVerifyArgs(process.argv.slice(2));
if (request.error) {
  process.stderr.write(`verify: ${request.error}\nUsage: node agent-team/scripts/verify.mjs --help\n`);
  process.exit(2);
}
if (request.help) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const fileNamesIn = (relativeDir) => {
  const dir = join(root, relativeDir);
  return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name) : [];
};
const plan = planVerify(request, Object.fromEntries(Object.entries(PACKAGES).map(
  ([pkg, { dir, testDir }]) => [pkg, existsSync(join(root, dir)) ? fileNamesIn(testDir) : null],
)));

const steps = [];
function record(step) {
  steps.push(step);
  const timing = step.timedOut ? `timed out after ${step.ms} ms; process tree killed` : `${step.ms} ms`;
  process.stdout.write(`${step.ok ? "PASS" : "RED "} ${step.label} (${timing})\n`);
  if (!step.ok && step.tail) process.stdout.write(`${step.tail}\n`);
  return step.ok;
}
const run = async (label, command, cwd, timeoutMs = 600_000) => record(await runStep(label, command, cwd, timeoutMs));

function reportBuildLeftovers() {
  const { restored, changed, error } = restoreLineEndingOnlyChanges(root, "frontend/public");
  if (error) process.stdout.write(`note: could not check frontend/public after the build (${error})\n`);
  if (restored.length) process.stdout.write(`note: restored line-ending-only changes the build left: ${restored.join(", ")}\n`);
  if (changed.length) process.stdout.write(`note: frontend/public still differs from the index (real changes, left as they are): ${changed.join(", ")}\n`);
}

async function verifyWorker(cwd, tests) {
  await run("worker: tsc --noEmit", "npx tsc --noEmit", cwd);
  for (const file of tests) await run(`worker: ${file}`, `node "scripts/${file}"`, cwd, 180_000);
}

async function verifyFrontend(cwd, tests) {
  await run("frontend: typecheck", "npm run typecheck", cwd);
  await run("frontend: verify:i18n", "npm run verify:i18n", cwd);
  if (request.mode === "fast") return;
  const { terms } = request;
  if (terms.length) {
    const chain = `node tests/runTestChain.ts --no-preflight ${terms.map((term) => JSON.stringify(term)).join(" ")}`;
    await run(`frontend: ${tests.length} test file${tests.length === 1 ? "" : "s"} matching ${quoteTerms(terms)}`, chain, cwd, 3_600_000);
  } else {
    await run(`frontend: every test file (${tests.length})`, "node tests/runTestChain.ts", cwd, 3_600_000);
  }
  await run("frontend: build", "npm run build", cwd);
  reportBuildLeftovers();
}

if (plan.problems.length) {
  for (const label of plan.problems) {
    steps.push({ label, ok: false, ms: 0 });
    process.stdout.write(`RED  ${label}\n`);
  }
} else {
  await run("agent adapters in sync", "node agent-team/scripts/validate-team.mjs", root);
  for (const { pkg, dir, tests } of plan.packages) {
    const cwd = join(root, dir);
    if (!existsSync(join(cwd, "node_modules")) && !(await run(`${dir}: npm ci`, "npm ci --no-audit --no-fund", cwd, 900_000))) continue;
    if (pkg === "worker") await verifyWorker(cwd, tests);
    else await verifyFrontend(cwd, tests);
  }
}

const { line, exitCode } = summarizeVerify(request, plan, steps);
process.stdout.write(`\n${line}\n`);
process.exit(exitCode);
