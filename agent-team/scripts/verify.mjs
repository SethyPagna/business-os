import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const terms = args.filter((a) => !a.startsWith("--"));
const mode = flags.has("--fast") ? "fast" : "full";
const only = (pkg) => !flags.has(`--no-${pkg}`);

if (flags.has("--help")) {
  process.stdout.write(`node agent-team/scripts/verify.mjs [--fast] [--no-frontend] [--no-worker] [term ...]

  (default)   full gate: both typechecks, i18n, frontend build, every test file run alone
  --fast      typechecks + i18n + agent adapters only (seconds, for the inner loop)
  term ...    run only test files whose name contains a term (both packages)
  --no-frontend / --no-worker   skip one package
Exit 0 only when every step is green. The last line is a one-line summary.
`);
  process.exit(0);
}

const steps = [];
function run(label, command, cwd, timeoutMs = 600_000) {
  const started = Date.now();
  const result = spawnSync(command, { cwd, shell: true, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  const ok = result.status === 0;
  const ms = Date.now() - started;
  steps.push({ label, ok, ms });
  process.stdout.write(`${ok ? "PASS" : "RED "} ${label} (${ms} ms)\n`);
  if (!ok) {
    const tail = `${result.stdout || ""}${result.stderr || ""}`.trim().split("\n").slice(-15).join("\n");
    process.stdout.write(`${tail}\n`);
  }
  return ok;
}

function ensureModules(pkg) {
  if (existsSync(join(root, pkg, "node_modules"))) return true;
  return run(`${pkg}: npm ci`, "npm ci --no-audit --no-fund", join(root, pkg), 900_000);
}

function restoreLineEndingNoise() {
  const changed = spawnSync("git", ["diff", "--name-only", "--", "frontend/public"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  for (const file of changed) {
    const real = spawnSync("git", ["diff", "--ignore-cr-at-eol", "--quiet", "--", file], { cwd: root });
    if (real.status === 0) spawnSync("git", ["checkout", "--", file], { cwd: root });
  }
}

run("agent adapters in sync", "node agent-team/scripts/validate-team.mjs", root);

if (only("worker") && existsSync(join(root, "cloudflare")) && ensureModules("cloudflare")) {
  const cf = join(root, "cloudflare");
  run("worker: tsc --noEmit", "npx tsc --noEmit", cf);
  if (mode === "full") {
    const tests = readdirSync(join(cf, "scripts"))
      .filter((f) => /^test-.*\.cjs$/.test(f))
      .filter((f) => terms.length === 0 || terms.some((t) => f.toLowerCase().includes(t.toLowerCase())))
      .sort();
    for (const f of tests) run(`worker: ${f}`, `node "scripts/${f}"`, cf, 180_000);
  }
}

if (only("frontend") && existsSync(join(root, "frontend")) && ensureModules("frontend")) {
  const fe = join(root, "frontend");
  run("frontend: typecheck", "npm run typecheck", fe);
  run("frontend: verify:i18n", "npm run verify:i18n", fe);
  if (mode === "full") {
    const chain = terms.length ? `node tests/runTestChain.ts --no-preflight ${terms.map((t) => JSON.stringify(t)).join(" ")}` : "node tests/runTestChain.ts";
    run(terms.length ? `frontend: tests matching ${terms.join(",")}` : "frontend: every test file", chain, fe, 3_600_000);
    run("frontend: build", "npm run build", fe);
    restoreLineEndingNoise();
  }
}

const reds = steps.filter((s) => !s.ok);
const seconds = Math.round(steps.reduce((n, s) => n + s.ms, 0) / 1000);
process.stdout.write(`\nverify ${mode}: ${steps.length - reds.length}/${steps.length} green in ${seconds}s${reds.length ? ` — RED: ${reds.map((s) => s.label).join("; ")}` : ""}\n`);
process.exit(reds.length ? 1 : 0);
