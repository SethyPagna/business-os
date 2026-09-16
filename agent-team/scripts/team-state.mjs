import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, renameSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const roleIds = new Set(JSON.parse(readFileSync(join(root, "agent-team/agents.json"), "utf8")).agents.map((agent) => agent.id));
const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim();
const stateDir = join(gitDir, "agent-team");
const statePath = join(stateDir, "state.json");
const lockPath = join(stateDir, "state.lock");
const [command = "status", ...tokens] = process.argv.slice(2);
const arg = (name) => { const i = tokens.indexOf(`--${name}`); return i >= 0 ? tokens[i + 1] : undefined; };
const args = (name) => tokens.flatMap((value, index) => value === `--${name}` && tokens[index + 1] ? [tokens[index + 1]] : []);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const now = () => new Date().toISOString();
const empty = () => ({ schemaVersion: 1, claims: [], messages: [] });
const lockOwnerPath = join(lockPath, "owner.json");
const staleLockMs = 30_000;
const repositoryRealPath = realpathSync.native(root);
let heldLockNonce = null;

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

function recoverStaleLock() {
  let createdAt;
  let ownerPid;
  let ownerNonce;
  try {
    const owner = JSON.parse(readFileSync(lockOwnerPath, "utf8"));
    createdAt = Date.parse(owner.created_at);
    ownerPid = owner.pid;
    ownerNonce = owner.nonce;
  } catch {
    try { createdAt = statSync(lockPath).mtimeMs; } catch { return; }
    ownerNonce = `unknown-${Math.trunc(createdAt)}`;
  }
  if (Number.isFinite(createdAt) && Date.now() - createdAt > staleLockMs && !processIsAlive(ownerPid)) {
    const safeNonce = String(ownerNonce || "missing").replace(/[^A-Za-z0-9._-]/g, "_");
    const tombstone = join(stateDir, `state.lock.stale.${safeNonce}`);
    try { renameSync(lockPath, tombstone); }
    catch (error) { if (!["ENOENT", "EEXIST", "ENOTEMPTY"].includes(error.code)) throw error; }
  }
}

function lock() {
  mkdirSync(stateDir, { recursive: true });
  for (let i = 0; i < 30; i += 1) {
    try {
      mkdirSync(lockPath);
      heldLockNonce = randomUUID();
      writeFileSync(lockOwnerPath, `${JSON.stringify({ pid: process.pid, nonce: heldLockNonce, created_at: now() })}\n`, "utf8");
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      recoverStaleLock();
      sleep(100);
    }
  }
  throw new Error(`Agent-team state is busy: ${lockPath}`);
}
function unlock() {
  if (!heldLockNonce) return;
  let owner;
  try { owner = JSON.parse(readFileSync(lockOwnerPath, "utf8")); } catch { heldLockNonce = null; return; }
  if (owner.nonce === heldLockNonce) rmSync(lockPath, { recursive: true, force: true });
  heldLockNonce = null;
}
function load() { return existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : empty(); }
function save(state) {
  const temporary = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(temporary, statePath);
}
function mutate(operation) { lock(); try { const state = load(); const value = operation(state); save(state); return value; } finally { unlock(); } }
function portablePath(path) {
  const parts = path?.split(/[\\/]/) || [];
  const invalidWindowsPart = parts.some((part) => part !== "." && (/[ .]$/.test(part) || part.includes(":") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part)));
  if (!path || isAbsolute(path) || /^(?:[A-Za-z]:|[\\/]{2})/.test(path) || /[*?\[\]]/.test(path) || parts.includes("..") || invalidWindowsPart) {
    throw new Error(`Write paths must be exact repository-relative paths: ${path}`);
  }
  const segments = path.replaceAll("\\", "/").split("/").filter((part) => part && part !== ".");
  let resolvedPath = repositoryRealPath;
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = join(resolvedPath, segments[index]);
    if (existsSync(candidate)) resolvedPath = realpathSync.native(candidate);
    else { resolvedPath = join(resolvedPath, ...segments.slice(index)); break; }
  }
  let normalized = relative(repositoryRealPath, resolvedPath).replaceAll("\\", "/") || ".";
  if (normalized === ".." || normalized.startsWith("../") || isAbsolute(normalized)) throw new Error(`Write path resolves outside the repository: ${path}`);
  if (process.platform === "win32") normalized = normalized.toLowerCase();
  return normalized;
}
function portableResource(resource) {
  const normalized = resource.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(normalized)) throw new Error(`Resource must be a portable identifier: ${resource}`);
  return normalized;
}
function overlaps(a, b) { return a === "." || b === "." || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`); }

function assert(condition, message) { if (!condition) throw new Error(message); }
function assertObject(value, path, allowed, required = []) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${path} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  assert(!unknown.length, `${path} has unknown fields: ${unknown.join(", ")}`);
  const missing = required.filter((key) => value[key] === undefined);
  assert(!missing.length, `${path} is missing required fields: ${missing.join(", ")}`);
}
function assertString(value, path, { nonempty = false, pattern } = {}) {
  assert(typeof value === "string", `${path} must be a string`);
  if (nonempty) assert(value.length > 0, `${path} must not be empty`);
  if (pattern) assert(pattern.test(value), `${path} has an invalid format`);
}
function assertStringArray(value, path, { nonemptyItems = false, unique = false } = {}) {
  assert(Array.isArray(value), `${path} must be an array`);
  value.forEach((item, index) => assertString(item, `${path}[${index}]`, { nonempty: nonemptyItems }));
  if (unique) assert(new Set(value).size === value.length, `${path} must contain unique items`);
}
function assertCommit(sha, path) {
  assertString(sha, path, { pattern: /^[0-9a-f]{40}$/ });
  try { execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "ignore" }); }
  catch { throw new Error(`${path} must resolve to a commit in this repository`); }
}
function validateTask(value) {
  const keys = ["schema_version", "run_id", "task_id", "role", "objective", "base_sha", "mode", "ownership", "worktree", "branch", "dependencies", "acceptance_criteria", "verification", "side_effect_policy", "delegation"];
  const required = ["schema_version", "run_id", "task_id", "role", "objective", "base_sha", "mode", "ownership", "acceptance_criteria", "verification", "side_effect_policy"];
  assertObject(value, "task", keys, required);
  assert(value.schema_version === 1, "task.schema_version must be 1");
  assertString(value.run_id, "task.run_id", { nonempty: true });
  assertString(value.task_id, "task.task_id", { pattern: /^[a-z0-9][a-z0-9-]*$/ });
  assertString(value.role, "task.role", { nonempty: true });
  assert(roleIds.has(value.role), `task.role is not a registered agent: ${value.role}`);
  assertString(value.objective, "task.objective", { nonempty: true });
  assertCommit(value.base_sha, "task.base_sha");
  assert(["read_only", "workspace_write"].includes(value.mode), "task.mode must be read_only or workspace_write");
  assertObject(value.ownership, "task.ownership", ["include", "exclude"], ["include", "exclude"]);
  assertStringArray(value.ownership.include, "task.ownership.include", { unique: true });
  assertStringArray(value.ownership.exclude, "task.ownership.exclude", { unique: true });
  value.ownership.include.forEach(portablePath);
  value.ownership.exclude.forEach(portablePath);
  if (value.worktree !== undefined) assertString(value.worktree, "task.worktree", { nonempty: true });
  if (value.branch !== undefined) assertString(value.branch, "task.branch", { nonempty: true });
  if (value.mode === "workspace_write") {
    assert(value.ownership.include.length > 0, "workspace_write task requires at least one owned path");
    assert(typeof value.worktree === "string" && value.worktree.length > 0, "workspace_write task requires a nonempty worktree");
    assert(typeof value.branch === "string" && value.branch.length > 0, "workspace_write task requires a nonempty branch");
  }
  if (value.dependencies !== undefined) assertStringArray(value.dependencies, "task.dependencies");
  assertStringArray(value.acceptance_criteria, "task.acceptance_criteria", { nonemptyItems: true });
  assertStringArray(value.verification, "task.verification", { nonemptyItems: true });
  assert(["none", "workspace_only", "user_authorization_required"].includes(value.side_effect_policy), "task.side_effect_policy is invalid");
  if (value.delegation !== undefined) {
    assertObject(value.delegation, "task.delegation", ["allowed", "max_depth"]);
    if (value.delegation.allowed !== undefined) assert(typeof value.delegation.allowed === "boolean", "task.delegation.allowed must be boolean");
    if (value.delegation.max_depth !== undefined) assert(Number.isInteger(value.delegation.max_depth) && value.delegation.max_depth >= 0 && value.delegation.max_depth <= 2, "task.delegation.max_depth must be an integer from 0 to 2");
  }
}
function validateResult(value) {
  const keys = ["schema_version", "task_id", "agent", "status", "summary", "base_sha", "head_sha", "changes", "commits", "evidence", "verification", "risks", "blockers", "not_done", "handoff", "workspace"];
  const required = ["schema_version", "task_id", "agent", "status", "summary", "base_sha", "changes", "evidence", "verification", "risks", "not_done"];
  assertObject(value, "result", keys, required);
  assert(value.schema_version === 1, "result.schema_version must be 1");
  assertString(value.task_id, "result.task_id", { nonempty: true });
  assertObject(value.agent, "result.agent", ["provider", "role", "session_id"], ["provider", "role"]);
  assert(["codex", "claude-code", "copilot", "other"].includes(value.agent.provider), "result.agent.provider is invalid");
  assertString(value.agent.role, "result.agent.role");
  if (value.agent.session_id !== undefined) assertString(value.agent.session_id, "result.agent.session_id");
  assert(["completed", "partial", "blocked", "failed", "not_applicable"].includes(value.status), "result.status is invalid");
  ["summary", "handoff"].forEach((field) => { if (value[field] !== undefined) assertString(value[field], `result.${field}`); });
  assertCommit(value.base_sha, "result.base_sha");
  if (value.head_sha !== undefined) assertCommit(value.head_sha, "result.head_sha");
  ["changes", "commits", "risks", "blockers", "not_done"].forEach((field) => { if (value[field] !== undefined) assertStringArray(value[field], `result.${field}`); });
  assert(Array.isArray(value.evidence), "result.evidence must be an array");
  value.evidence.forEach((item, index) => {
    const path = `result.evidence[${index}]`;
    assertObject(item, path, ["claim", "source", "locator", "observed"], ["claim", "locator", "observed"]);
    ["claim", "source", "locator", "observed"].forEach((field) => { if (item[field] !== undefined) assertString(item[field], `${path}.${field}`); });
  });
  assert(Array.isArray(value.verification), "result.verification must be an array");
  value.verification.forEach((item, index) => {
    const path = `result.verification[${index}]`;
    assertObject(item, path, ["command", "scope", "exit_code", "expected", "observed"], ["command", "scope", "exit_code", "expected", "observed"]);
    ["command", "scope", "expected", "observed"].forEach((field) => assertString(item[field], `${path}.${field}`));
    assert(Number.isInteger(item.exit_code), `${path}.exit_code must be an integer`);
  });
  if (value.workspace !== undefined) {
    assertObject(value.workspace, "result.workspace", ["branch", "worktree", "dirty_before", "dirty_after"]);
    ["branch", "worktree"].forEach((field) => { if (value.workspace[field] !== undefined) assertString(value.workspace[field], `result.workspace.${field}`); });
    ["dirty_before", "dirty_after"].forEach((field) => { if (value.workspace[field] !== undefined) assertStringArray(value.workspace[field], `result.workspace.${field}`); });
  }
}

if (command === "status") {
  const state = load();
  const staleBefore = Date.now() - 2 * 60 * 60 * 1000;
  process.stdout.write(`${JSON.stringify({ ...state, claims: state.claims.map((claim) => ({ ...claim, stale: Date.parse(claim.heartbeat_at) < staleBefore })) }, null, 2)}\n`);
} else if (command === "claim") {
  const task = arg("task"), agent = arg("agent"), mode = arg("mode"), resource = arg("resource") ? portableResource(arg("resource")) : undefined;
  const authorization = arg("authorization");
  const paths = args("path").map(portablePath);
  if (!task || !agent || !["read", "write"].includes(mode)) throw new Error("claim requires --task, --agent, and --mode read|write");
  if (mode === "write" && !paths.length && !resource) throw new Error("write claim requires at least one --path or --resource");
  if (authorization) throw new Error("The coordination ledger cannot grant authorization; remove --authorization and re-check user approval in the executing client");
  if (resource === "production") throw new Error("The coordination ledger cannot claim production; use production-coordination only for mutual exclusion and obtain user approval separately");
  const claim = mutate((state) => {
    const conflict = state.claims.find((existing) => mode === "write" && existing.mode === "write" && ((resource && existing.resource === resource) || paths.some((path) => existing.paths.some((owned) => overlaps(path, owned)))));
    if (conflict) throw new Error(`Conflicts with claim ${conflict.id} owned by ${conflict.agent} for ${conflict.task}`);
    const created = { id: randomUUID(), task, agent, mode, paths, resource: resource || null, authorization: null, worktree: arg("worktree") || null, branch: arg("branch") || null, created_at: now(), heartbeat_at: now() };
    state.claims.push(created); return created;
  });
  process.stdout.write(`${JSON.stringify(claim, null, 2)}\n`);
} else if (command === "heartbeat") {
  const id = arg("claim");
  const claim = mutate((state) => { const found = state.claims.find((item) => item.id === id); if (!found) throw new Error(`Unknown claim: ${id}`); found.heartbeat_at = now(); return found; });
  process.stdout.write(`${JSON.stringify(claim, null, 2)}\n`);
} else if (command === "release") {
  const id = arg("claim");
  const released = mutate((state) => { const index = state.claims.findIndex((item) => item.id === id); if (index < 0) throw new Error(`Unknown claim: ${id}`); return state.claims.splice(index, 1)[0]; });
  process.stdout.write(`Released ${released.id}\n`);
} else if (command === "message") {
  const from = arg("from"), to = arg("to"), text = arg("text");
  if (!from || !to || !text) throw new Error("message requires --from, --to, and --text");
  const message = mutate((state) => { const item = { id: randomUUID(), from, to, text, created_at: now(), read_at: null }; state.messages.push(item); state.messages = state.messages.slice(-500); return item; });
  process.stdout.write(`${JSON.stringify(message, null, 2)}\n`);
} else if (command === "inbox") {
  const agent = arg("agent"); if (!agent) throw new Error("inbox requires --agent");
  const inbox = mutate((state) => { const items = state.messages.filter((item) => (item.to === agent || item.to === "*") && !item.read_at); items.forEach((item) => item.read_at = now()); return items; });
  process.stdout.write(`${JSON.stringify(inbox, null, 2)}\n`);
} else if (command === "doctor") {
  execFileSync(process.execPath, [join(root, "agent-team/scripts/validate-team.mjs")], { cwd: root, stdio: "inherit" });
  process.stdout.write(`Shared state: ${statePath}\nRepository: ${relative(process.cwd(), root) || "."}\n`);
} else if (command === "validate-task" || command === "validate-result") {
  const file = arg("file");
  if (!file) throw new Error(`${command} requires --file`);
  const value = JSON.parse(readFileSync(resolve(process.cwd(), file), "utf8"));
  if (command === "validate-task") validateTask(value); else validateResult(value);
  process.stdout.write(`${command === "validate-task" ? "Task" : "Result"} envelope valid: ${value.task_id}\n`);
} else {
  throw new Error("Commands: status, claim, heartbeat, release, message, inbox, validate-task, validate-result, doctor");
}
