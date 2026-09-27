import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const scratchDirs = [];
const startedPids = [];

function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

function writeFile(base, relativePath, content, mode) {
  const path = join(base, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, mode ? { mode } : undefined);
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

async function survivorsAfterWaiting(pids) {
  for (let attempt = 0; attempt < 50 && pids.some(isAlive); attempt += 1) {
    await new Promise((wake) => setTimeout(wake, 100));
  }
  return pids.filter(isAlive);
}

// A repository shape whose every step is cheap and green (fake tsc, `node -e 0` npm scripts, empty
// test files), so each outcome below is decided by verify.mjs's own selection and summary logic.
function makeFixture() {
  const fixture = scratchDir("verify-fixture-");
  for (const name of readdirSync(here).filter((file) => file.endsWith(".mjs"))) {
    writeFile(fixture, `agent-team/scripts/${name}`, readFileSync(join(here, name)));
  }
  writeFile(fixture, "agent-team/scripts/validate-team.mjs", "");
  writeFile(fixture, "cloudflare/package.json", '{"name":"fixture-worker","private":true}\n');
  writeFile(fixture, "cloudflare/node_modules/.bin/tsc", "#!/bin/sh\nexit 0\n", 0o755);
  writeFile(fixture, "cloudflare/node_modules/.bin/tsc.cmd", "@echo off\r\nexit /b 0\r\n");
  writeFile(fixture, "cloudflare/scripts/test-pass-pure.cjs", "");
  const scripts = { typecheck: "node -e 0", "verify:i18n": "node -e 0", build: "node -e 0" };
  writeFile(fixture, "frontend/package.json", `${JSON.stringify({ name: "fixture-frontend", private: true, scripts })}\n`);
  mkdirSync(join(fixture, "frontend/node_modules"), { recursive: true });
  writeFile(fixture, "frontend/tests/runTestChain.ts", readFileSync(join(root, "frontend/tests/runTestChain.ts")));
  writeFile(fixture, "frontend/tests/alpha.test.ts", "");
  return fixture;
}

function expectVerify(fixture, args, expected) {
  const result = spawnSync(process.execPath, ["agent-team/scripts/verify.mjs", ...args], { cwd: fixture, encoding: "utf8", timeout: 120_000 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const lastLine = output.trim().split(/\r?\n/).at(-1) ?? "";
  const context = `verify.mjs ${args.join(" ")} exited ${result.status}; last line: ${lastLine}\n${output}`;
  assert.equal(result.status, expected.status, context);
  if (expected.lastLine) assert.ok(lastLine.startsWith(expected.lastLine), `expected a summary starting with: ${expected.lastLine}\n${context}`);
  if (expected.output) assert.match(output, expected.output, context);
}

function checkVerifyCommandLine() {
  const fixture = makeFixture();
  expectVerify(fixture, ["--no-frontend", "zzz-nomatch"], {
    status: 1,
    output: /RED\s+worker: no test file in cloudflare\/scripts matches "zzz-nomatch"/,
    lastLine: 'verify partial (tests matching "zzz-nomatch"; frontend skipped; worker: 0 test files): 0/1 green',
  });
  expectVerify(fixture, ["zzz-nomatch"], {
    status: 1,
    output: /RED\s+frontend: no test file in frontend\/tests matches "zzz-nomatch"/,
  });
  expectVerify(fixture, ["--no-worker", "alpha"], {
    status: 0,
    lastLine: 'verify partial (tests matching "alpha"; worker skipped; frontend: 1 test file): 5/5 green',
  });
  expectVerify(fixture, ["--no-frontend", "pass-pure"], {
    status: 0,
    lastLine: 'verify partial (tests matching "pass-pure"; frontend skipped; worker: 1 test file): 3/3 green',
  });
  expectVerify(fixture, ["--no-frontend", "--no-worker"], { status: 0, lastLine: "verify partial (worker skipped; frontend skipped): 1/1 green" });
  expectVerify(fixture, ["--no-workers", "--no-frontend", "pass-pure"], { status: 2, output: /unknown flag --no-workers/ });
  expectVerify(fixture, ["--fast", "zzz-nomatch"], { status: 2, output: /--fast runs no test files/ });
}

function checkDecisions({ parseVerifyArgs, planVerify, summarizeVerify }) {
  assert.deepEqual(parseVerifyArgs([]), { help: false, mode: "full", terms: [], skipped: [] });
  assert.equal(parseVerifyArgs(["-h"]).help, true);
  assert.match(parseVerifyArgs(["-fast"]).error, /unknown flag -fast/);
  assert.deepEqual(parseVerifyArgs(["--no-frontend", "--no-worker", "Receipt"]).skipped, ["worker", "frontend"]);

  const full = parseVerifyArgs([]);
  const files = { worker: ["helper.cjs", "test-b-pure.cjs", "test-a-pure.cjs"], frontend: ["runTestChain.ts", "b.test.cjs", "a.test.ts"] };
  const fullPlan = planVerify(full, files);
  assert.deepEqual(fullPlan, {
    packages: [
      { pkg: "worker", dir: "cloudflare", tests: ["test-a-pure.cjs", "test-b-pure.cjs"] },
      { pkg: "frontend", dir: "frontend", tests: ["a.test.ts", "b.test.cjs"] },
    ],
    problems: [],
  });
  const filtered = planVerify(parseVerifyArgs(["A-PURE"]), files);
  assert.deepEqual(filtered.packages[0].tests, ["test-a-pure.cjs"]);
  assert.deepEqual(filtered.problems, ['frontend: no test file in frontend/tests matches "A-PURE" (add --no-frontend to skip it)']);
  assert.deepEqual(planVerify(full, { ...files, worker: null }).problems, ["worker: package folder cloudflare not found"]);
  assert.deepEqual(planVerify(full, { ...files, worker: ["helper.cjs"] }).problems, ["worker: no test file found in cloudflare/scripts"]);
  assert.deepEqual(planVerify(parseVerifyArgs(["--fast"]), { worker: [], frontend: [] }).problems, []);

  const green = (label) => ({ label, ok: true, ms: 1000 });
  assert.deepEqual(summarizeVerify(full, fullPlan, [green("a"), green("b")]), {
    line: "verify full (worker: 2 test files; frontend: 2 test files): 2/2 green in 2s",
    exitCode: 0,
  });
  assert.deepEqual(summarizeVerify(full, fullPlan, [green("a"), { label: "b", ok: false, ms: 0 }]), {
    line: "verify full (worker: 2 test files; frontend: 2 test files): 1/2 green in 1s — RED: b",
    exitCode: 1,
  });
  const fast = parseVerifyArgs(["--fast"]);
  assert.equal(summarizeVerify(fast, planVerify(fast, files), [green("a")]).line, "verify fast: 1/1 green in 1s");
  const fastWorkerless = parseVerifyArgs(["--fast", "--no-worker"]);
  assert.equal(summarizeVerify(fastWorkerless, planVerify(fastWorkerless, files), [green("a")]).line, "verify fast partial (worker skipped): 1/1 green in 1s");
  assert.equal(summarizeVerify(full, fullPlan, []).exitCode, 1);
}

async function checkRunStep({ runStep }) {
  const dir = scratchDir("verify-runstep-");
  writeFile(dir, "claims-pass.cjs", 'console.log("PASS: 12/12 assertions");\nprocess.exit(1);\n');
  const claimsPass = await runStep("claims pass", `node "${join(dir, "claims-pass.cjs")}"`, dir, 30_000);
  assert.equal(claimsPass.ok, false, "the exit code decides, not the printed text");
  assert.match(claimsPass.tail, /PASS: 12\/12 assertions/);

  writeFile(dir, "hang-with-child.cjs", [
    'const { spawn } = require("node:child_process");',
    'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
    "require(\"node:fs\").writeFileSync(process.argv[2], JSON.stringify([process.pid, grandchild.pid]));",
    "setInterval(() => {}, 1000);",
    "",
  ].join("\n"));
  const pidFile = join(dir, "pids.json");
  const hung = await runStep("hang", `node "${join(dir, "hang-with-child.cjs")}" "${pidFile}"`, dir, 4000);
  const pids = JSON.parse(readFileSync(pidFile, "utf8"));
  startedPids.push(...pids);
  assert.equal(hung.ok, false);
  assert.equal(hung.timedOut, true);
  assert.deepEqual(await survivorsAfterWaiting(pids), [], "a timed-out step must not leave any process of its tree running");
}

function checkLineEndingRestore({ restoreLineEndingOnlyChanges }) {
  const repo = scratchDir("verify-crlf-");
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q");
  git("config", "core.autocrlf", "true");
  git("config", "core.safecrlf", "false");
  git("config", "core.fsmonitor", "false");
  writeFile(repo, "public/noise.js", "one\ntwo\n");
  writeFile(repo, "public/real.js", "one\ntwo\n");
  git("add", "public");
  rmSync(join(repo, "public"), { recursive: true });
  git("checkout", "--", "public");
  assert.ok(readFileSync(join(repo, "public/noise.js"), "utf8").includes("\r\n"), "precondition: an autocrlf checkout writes CRLF");

  writeFile(repo, "public/noise.js", "one\ntwo\n");
  writeFile(repo, "public/real.js", "one\nTWO\n");
  assert.deepEqual(git("diff", "--name-only").trim().split("\n"), ["public/real.js"], "precondition: git diff cannot see the line-ending-only file");

  assert.deepEqual(restoreLineEndingOnlyChanges(repo, "public"), { restored: ["public/noise.js"], changed: ["public/real.js"] });
  assert.equal(readFileSync(join(repo, "public/real.js"), "utf8"), "one\nTWO\n", "a file with a real change is never touched");
}

try {
  checkVerifyCommandLine();
  const lib = await import("./verify-lib.mjs");
  checkDecisions(lib);
  await checkRunStep(lib);
  checkLineEndingRestore(lib);
} finally {
  for (const pid of startedPids.filter(isAlive)) {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/F"], { stdio: "ignore" });
    else process.kill(pid, "SIGKILL");
  }
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
}

process.stdout.write("verify.mjs tests passed.\n");
