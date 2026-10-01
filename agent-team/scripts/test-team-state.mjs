import { execFile, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = mkdtempSync(join(tmpdir(), "business-os-agent-team-"));
const root = fixtureDir;
assert(dirname(realpathSync.native(root)) === realpathSync.native(tmpdir()), "Fixture cleanup must stay inside the temporary directory");
mkdirSync(join(root, "agent-team/scripts"), { recursive: true });
copyFileSync(join(sourceRoot, "agent-team/scripts/team-state.mjs"), join(root, "agent-team/scripts/team-state.mjs"));
copyFileSync(join(sourceRoot, "agent-team/agents.json"), join(root, "agent-team/agents.json"));
const fixtureGit = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
fixtureGit(["init", "--quiet"]);
fixtureGit(["add", "--", "agent-team/scripts/team-state.mjs", "agent-team/agents.json"]);
fixtureGit(["-c", "user.name=Agent fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "Disposable agent-team fixture"]);
const cli = join(root, "agent-team/scripts/team-state.mjs");
const invoke = (args) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const invokeAsync = async (args) => (await promisify(execFile)(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" })).stdout;
const expectFailure = (args, contains) => {
  try { invoke(args); throw new Error(`Expected failure: ${args.join(" ")}`); }
  catch (error) {
    const output = `${error.stderr || ""}${error.message || ""}`;
    if (!output.includes(contains)) throw error;
  }
};

const claims = [];
const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
const statePath = join(gitDir, "agent-team/state.json");
const staleLockPath = join(gitDir, "agent-team", "state.lock");
const staleOwnerPath = join(staleLockPath, "owner.json");
const staleNonce = `selftest-stale-${process.pid}`;
const staleTombstonePath = join(gitDir, "agent-team", `state.lock.stale.${staleNonce}`);
const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
let injectedStaleLock = false;
try {
  const absentState = JSON.parse(invoke(["status", "--claims-only"]));
  assert.deepEqual(absentState, { schemaVersion: 1, claims: [] }, "Claims-only absent state must exclude messages");
  assert.equal(existsSync(statePath), false, "Read-only status must not create state");
  const peerText = "SYNTHETIC_PEER_CONCLUSION_MUST_NOT_REACH_RAW_FIRST_REVIEW";
  const futureText = "SYNTHETIC_FUTURE_METADATA_MUST_NOT_REACH_RAW_FIRST_REVIEW";
  const sampleClaim = { id: "synthetic-current", task: "synthetic ownership", agent: "synthetic", mode: "write", paths: ["owned.txt"], resource: null, authorization: null, worktree: root, branch: "fixture", created_at: "2000-01-01T00:00:00.000Z", heartbeat_at: new Date(Date.now() + 60_000).toISOString() };
  const seeded = {
    schemaVersion: 1,
    claims: [sampleClaim, { ...sampleClaim, id: "synthetic-stale", heartbeat_at: "2000-01-01T00:00:00.000Z" }, { ...sampleClaim, id: "synthetic-invalid-time", heartbeat_at: "invalid" }],
    messages: [{ id: "synthetic-message", text: peerText }],
    futureMetadata: { summary: futureText }
  };
  mkdirSync(dirname(statePath), { recursive: true });
  const seededBytes = Buffer.from(`${JSON.stringify(seeded)}\n`);
  writeFileSync(statePath, seededBytes);
  const defaultStatus = JSON.parse(invoke(["status"]));
  const expectedClaims = seeded.claims.map((claim, index) => ({ ...claim, stale: index === 1 }));
  assert.deepEqual(defaultStatus, { ...seeded, claims: expectedClaims }, "Default status must preserve messages and future metadata");
  const claimsOnlyText = invoke(["status", "--claims-only"]);
  assert.deepEqual(JSON.parse(claimsOnlyText), { schemaVersion: seeded.schemaVersion, claims: expectedClaims }, "Claims-only output must include exactly schemaVersion and derived claims");
  assert.equal(claimsOnlyText.includes(peerText), false, "Claims-only output must exclude peer conclusions");
  assert.equal(claimsOnlyText.includes(futureText), false, "Claims-only output must exclude future metadata");
  assert.deepEqual(JSON.parse(invoke([])), defaultStatus, "No-argument status must preserve default behavior");
  assert.deepEqual(JSON.parse(invoke(["status", "--unrecognized", "value"])), defaultStatus, "Unknown status arguments remain ignored");
  assert.deepEqual(JSON.parse(invoke(["status", "--claims-only=false"])), defaultStatus, "Only the exact claims-only flag selects projection");
  assert.deepEqual(JSON.parse(invoke(["status", "--claims-only", "--unrecognized", "value"])), { schemaVersion: seeded.schemaVersion, claims: expectedClaims }, "Additional status arguments remain ignored");
  expectFailure(["not-a-command", "--claims-only"], "Commands: status");
  assert.deepEqual(readFileSync(statePath), seededBytes, "Every status invocation must preserve exact state bytes");
  assert.equal(existsSync(staleLockPath), false, "Read-only status must not acquire a lock");
  writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, claims: [], messages: [] }), "utf8");
  process.stdout.write("Claims-only status isolation checks passed (absent, seeded, stale, compatibility, bytes, lock).\n");
  try {
    mkdirSync(join(gitDir, "agent-team"), { recursive: true });
    mkdirSync(staleLockPath);
    injectedStaleLock = true;
    writeFileSync(staleOwnerPath, JSON.stringify({ pid: 2147483647, nonce: staleNonce, created_at: "2000-01-01T00:00:00.000Z" }), "utf8");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (injectedStaleLock) {
    const [lockA, lockB] = await Promise.all([
      invokeAsync(["claim", "--task", "selftest-lock-a", "--agent", "selftest-a", "--mode", "write", "--path", ".agent-lock-selftest-a"]),
      invokeAsync(["claim", "--task", "selftest-lock-b", "--agent", "selftest-b", "--mode", "write", "--path", ".agent-lock-selftest-b"])
    ]);
    claims.push(JSON.parse(lockA).id, JSON.parse(lockB).id);
    injectedStaleLock = false;
    rmSync(staleTombstonePath, { recursive: true, force: true });
  }
  const first = JSON.parse(invoke(["claim", "--task", "selftest-case", "--agent", "selftest", "--mode", "write", "--path", "Frontend//src/./__agent_team_selftest__.ts"]));
  claims.push(first.id);
  if (process.platform === "win32") {
    expectFailure(["claim", "--task", "selftest-case-conflict", "--agent", "selftest-2", "--mode", "write", "--path", "frontend/src/__agent_team_selftest__.ts"], "Conflicts with claim");
    expectFailure(["claim", "--task", "selftest-trailing-dot", "--agent", "selftest-2", "--mode", "write", "--path", "AGENTS.md."], "exact repository-relative paths");
    expectFailure(["claim", "--task", "selftest-trailing-space", "--agent", "selftest-2", "--mode", "write", "--path", "AGENTS.md "], "exact repository-relative paths");
    expectFailure(["claim", "--task", "selftest-ads", "--agent", "selftest-2", "--mode", "write", "--path", "AGENTS.md:stream"], "exact repository-relative paths");
    const shortAlias = join(root, "AGENT-~1");
    if (existsSync(shortAlias) && realpathSync.native(shortAlias).toLowerCase() === realpathSync.native(join(root, "agent-team")).toLowerCase()) {
      const aliasOwner = JSON.parse(invoke(["claim", "--task", "selftest-alias", "--agent", "selftest", "--mode", "write", "--path", "agent-team"]));
      claims.push(aliasOwner.id);
      expectFailure(["claim", "--task", "selftest-alias-conflict", "--agent", "selftest-2", "--mode", "write", "--path", "AGENT-~1"], "Conflicts with claim");
    }
  }
  expectFailure(["claim", "--task", "selftest-root-conflict", "--agent", "selftest-2", "--mode", "write", "--path", "."], "Conflicts with claim");
  expectFailure(["claim", "--task", "selftest-prod", "--agent", "selftest", "--mode", "write", "--resource", "Production"], "cannot claim production");
  expectFailure(["claim", "--task", "selftest-prod-auth", "--agent", "selftest", "--mode", "write", "--resource", "production-coordination", "--authorization", "user-message:selftest"], "cannot grant authorization");
  const productionOwner = JSON.parse(invoke(["claim", "--task", "selftest-prod-owner", "--agent", "selftest", "--mode", "write", "--resource", "production-coordination"]));
  claims.push(productionOwner.id);
  expectFailure(["claim", "--task", "selftest-prod-conflict", "--agent", "selftest-2", "--mode", "write", "--resource", "Production-Coordination "], "Conflicts with claim");

  const task = {
    schema_version: 1,
    run_id: "selftest-run",
    task_id: "selftest-task",
    role: "verifier",
    objective: "Validate the integration harness",
    base_sha: actualHead,
    mode: "read_only",
    ownership: { include: [], exclude: [] },
    acceptance_criteria: ["Validation succeeds"],
    verification: ["Run the harness"],
    side_effect_policy: "none"
  };
  const result = {
    schema_version: 1,
    task_id: "selftest-task",
    agent: { provider: "codex", role: "verifier" },
    status: "completed",
    summary: "Harness passed",
    base_sha: actualHead,
    changes: [],
    evidence: [{ claim: "Harness ran", locator: "stdout", observed: "pass" }],
    verification: [{ command: "selftest", scope: "agent-team", exit_code: 0, expected: "pass", observed: "pass" }],
    risks: [],
    not_done: []
  };
  const taskPath = join(fixtureDir, "task.json");
  const resultPath = join(fixtureDir, "result.json");
  writeFileSync(taskPath, JSON.stringify(task), "utf8");
  writeFileSync(resultPath, JSON.stringify(result), "utf8");
  invoke(["validate-task", "--file", taskPath]);
  invoke(["validate-result", "--file", resultPath]);

  writeFileSync(taskPath, JSON.stringify({ ...task, unexpected: true }), "utf8");
  expectFailure(["validate-task", "--file", taskPath], "unknown fields");
  writeFileSync(taskPath, JSON.stringify({ ...task, role: "invented-agent" }), "utf8");
  expectFailure(["validate-task", "--file", taskPath], "not a registered agent");
  writeFileSync(taskPath, JSON.stringify({ ...task, worktree: "" }), "utf8");
  expectFailure(["validate-task", "--file", taskPath], "must not be empty");
  writeFileSync(taskPath, JSON.stringify({ ...task, ownership: { include: ["../outside"], exclude: [] } }), "utf8");
  expectFailure(["validate-task", "--file", taskPath], "exact repository-relative paths");
  const writeTask = { ...task, mode: "workspace_write", ownership: { include: [], exclude: [] }, worktree: "C:/worktree", branch: "codex/selftest" };
  writeFileSync(taskPath, JSON.stringify(writeTask), "utf8");
  expectFailure(["validate-task", "--file", taskPath], "at least one owned path");
  writeFileSync(taskPath, JSON.stringify({ ...writeTask, ownership: { include: ["frontend/src/selftest.ts"], exclude: [] }, branch: "" }), "utf8");
  expectFailure(["validate-task", "--file", taskPath], "branch must not be empty");
  writeFileSync(resultPath, JSON.stringify({ ...result, verification: [{ ...result.verification[0], exit_code: "0" }] }), "utf8");
  expectFailure(["validate-result", "--file", resultPath], "exit_code must be an integer");
  writeFileSync(resultPath, JSON.stringify({ ...result, base_sha: "not-a-sha" }), "utf8");
  expectFailure(["validate-result", "--file", resultPath], "base_sha has an invalid format");
  writeFileSync(resultPath, JSON.stringify({ ...result, base_sha: "f".repeat(40) }), "utf8");
  expectFailure(["validate-result", "--file", resultPath], "must resolve to a commit");
} finally {
  if (injectedStaleLock) {
    try {
      const owner = JSON.parse(readFileSync(staleOwnerPath, "utf8"));
      if (owner.nonce === staleNonce) rmSync(staleLockPath, { recursive: true, force: true });
    } catch { /* recovered or replaced */ }
  }
  rmSync(staleTombstonePath, { recursive: true, force: true });
  for (const id of claims) {
    try { invoke(["release", "--claim", id]); } catch { /* best-effort cleanup */ }
  }
  rmSync(fixtureDir, { recursive: true, force: true });
}

process.stdout.write("Agent-team state integration tests passed.\n");
