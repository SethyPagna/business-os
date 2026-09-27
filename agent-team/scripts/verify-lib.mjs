import { spawn, spawnSync } from "node:child_process";

export const PACKAGES = {
  worker: { dir: "cloudflare", testDir: "cloudflare/scripts", testFile: /^test-.*\.cjs$/ },
  // Same discovery rule as frontend/tests/runTestChain.ts, which runs these files.
  frontend: { dir: "frontend", testDir: "frontend/tests", testFile: /\.test\.(?:ts|cjs)$/ },
};

export const USAGE = `node agent-team/scripts/verify.mjs [--fast] [--no-frontend] [--no-worker] [term ...]

  (default)      full gate: agent adapters, both typechecks, i18n, the frontend build, and
                 each cloudflare/scripts and frontend/tests test file run alone
  --fast         agent adapters, typechecks and i18n only; no test files (the inner loop)
  term ...       only test files whose name contains a term; a selected package with no
                 matching test file is RED
  --no-frontend / --no-worker   skip one package
  -h, --help     this text

Any other argument starting with "-" is an error. Exit 0 only when every step is green.
The last line is the summary. It says "full" only when no term and no --no-* flag narrowed
the run, otherwise "partial"; --fast runs say "fast" or "fast partial".
`;

const KNOWN_FLAGS = ["--fast", "--no-frontend", "--no-worker", "--help", "-h"];
const TAIL_LINES = 15;
const KEPT_OUTPUT_CHARS = 64 * 1024;

export const quoteTerms = (terms) => terms.map((term) => JSON.stringify(term)).join(" or ");
const plural = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function parseVerifyArgs(argv) {
  const flags = argv.filter((arg) => arg.startsWith("-"));
  const terms = argv.filter((arg) => !arg.startsWith("-"));
  const request = {
    help: flags.includes("--help") || flags.includes("-h"),
    mode: flags.includes("--fast") ? "fast" : "full",
    terms,
    skipped: Object.keys(PACKAGES).filter((pkg) => flags.includes(`--no-${pkg}`)),
  };
  const unknown = flags.filter((flag) => !KNOWN_FLAGS.includes(flag));
  if (unknown.length) {
    return { ...request, error: `unknown flag ${unknown.join(", ")} (known: ${KNOWN_FLAGS.join(", ")})` };
  }
  if (request.mode === "fast" && terms.length) {
    return { ...request, error: `--fast runs no test files, so ${quoteTerms(terms)} would be ignored; drop --fast or the terms` };
  }
  return request;
}

export function selectTestFiles(fileNames, testFile, terms) {
  const wanted = terms.map((term) => term.toLowerCase());
  return fileNames
    .filter((name) => testFile.test(name))
    .filter((name) => wanted.length === 0 || wanted.some((term) => name.toLowerCase().includes(term)))
    .sort();
}

// fileNamesByPackage: { worker: [...names in cloudflare/scripts] | null when the package folder is missing, frontend: ... }
export function planVerify(request, fileNamesByPackage) {
  const packages = [];
  const problems = [];
  for (const [pkg, { dir, testDir, testFile }] of Object.entries(PACKAGES)) {
    if (request.skipped.includes(pkg)) continue;
    const fileNames = fileNamesByPackage[pkg];
    if (!fileNames) {
      problems.push(`${pkg}: package folder ${dir} not found`);
      continue;
    }
    const tests = request.mode === "full" ? selectTestFiles(fileNames, testFile, request.terms) : [];
    if (request.mode === "full" && tests.length === 0) {
      problems.push(request.terms.length
        ? `${pkg}: no test file in ${testDir} matches ${quoteTerms(request.terms)} (add --no-${pkg} to skip it)`
        : `${pkg}: no test file found in ${testDir}`);
    }
    packages.push({ pkg, dir, tests });
  }
  return { packages, problems };
}

export function summarizeVerify(request, plan, steps) {
  const narrowed = request.terms.length > 0 || request.skipped.length > 0;
  const scope = request.mode === "fast" ? (narrowed ? "fast partial" : "fast") : (narrowed ? "partial" : "full");
  const details = [
    ...(request.terms.length ? [`tests matching ${quoteTerms(request.terms)}`] : []),
    ...request.skipped.map((pkg) => `${pkg} skipped`),
    ...(request.mode === "full" ? plan.packages.map(({ pkg, tests }) => `${pkg}: ${plural(tests.length, "test file")}`) : []),
  ];
  const reds = steps.filter((step) => !step.ok);
  const seconds = Math.round(steps.reduce((total, step) => total + step.ms, 0) / 1000);
  const redList = reds.length ? ` — RED: ${reds.map((step) => step.label).join("; ")}` : "";
  const line = `verify ${scope}${details.length ? ` (${details.join("; ")})` : ""}: ${steps.length - reds.length}/${steps.length} green in ${seconds}s${redList}`;
  return { line, exitCode: steps.length > 0 && reds.length === 0 ? 0 : 1 };
}

export function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The process group has already exited.
  }
}

const runningChildren = new Set();
let interruptsForwarded = false;

// On POSIX each step runs in its own process group so a timeout can kill the whole group.
// That also hides the step from the terminal's Ctrl+C, so pass interrupts on to it.
function forwardInterrupts() {
  if (interruptsForwarded || process.platform === "win32") return;
  interruptsForwarded = true;
  for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
    process.on(signal, () => {
      for (const pid of runningChildren) killProcessTree(pid);
      process.exit(exitCode);
    });
  }
}

export function runStep(label, command, cwd, timeoutMs) {
  forwardInterrupts();
  return new Promise((settle) => {
    const started = Date.now();
    let output = "";
    let timedOut = false;
    const keep = (chunk) => { output = (output + chunk).slice(-KEPT_OUTPUT_CHARS); };
    const child = spawn(command, { cwd, shell: true, windowsHide: true, detached: process.platform !== "win32" });
    runningChildren.add(child.pid);
    child.stdout.setEncoding("utf8").on("data", keep);
    child.stderr.setEncoding("utf8").on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
    }, timeoutMs);
    const finish = (ok) => {
      clearTimeout(timer);
      runningChildren.delete(child.pid);
      const tail = output.replace(/\r/g, "").trim().split("\n").slice(-TAIL_LINES).join("\n");
      settle({ label, ok, ms: Date.now() - started, timedOut, tail });
    };
    child.on("error", (error) => {
      keep(`\n${error.message}`);
      finish(false);
    });
    child.on("close", (code) => finish(code === 0 && !timedOut));
  });
}

export function restoreLineEndingOnlyChanges(root, pathspec) {
  const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  // `git status`, not `git diff --name-only`: under core.autocrlf=true a build that rewrites a CRLF
  // checkout with LF is "modified" for status (the size differs) but invisible to diff (same content).
  const worktreeChanges = () => {
    const status = git("status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=no", "--", pathspec);
    if (status.status !== 0) return null;
    return status.stdout.split("\0")
      .filter((entry) => entry.length > 3 && entry[1] !== " ")
      .map((entry) => ({ state: entry[1], file: entry.slice(3) }));
  };
  const before = worktreeChanges();
  if (!before) return { restored: [], changed: [], error: `git status failed in ${root}` };
  const restored = [];
  for (const { state, file } of before) {
    if (state !== "M") continue;
    const lineEndingsOnly = git("diff", "--ignore-cr-at-eol", "--quiet", "--", file).status === 0;
    if (lineEndingsOnly && git("checkout", "--", file).status === 0) restored.push(file);
  }
  return { restored, changed: (worktreeChanges() ?? []).map(({ file }) => file) };
}
