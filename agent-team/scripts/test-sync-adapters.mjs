import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = mkdtempSync(join(tmpdir(), "sync-adapters-test-"));
const SKILL_TARGETS = [".agents/skills", ".claude/skills", ".github/skills"];

function script(repo, name, ...args) {
  const result = spawnSync(process.execPath, [join(repo, "agent-team/scripts", name), ...args], { cwd: repo, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

// A copy of everything sync-adapters and validate-team read, with the adapters generated once.
function makeRepo() {
  const repo = mkdtempSync(join(scratch, "repo-"));
  for (const path of ["agent-team", ".claude/settings.json", ".codex/hooks.json", ".mcp.json"]) {
    cpSync(join(root, path), join(repo, path), { recursive: true });
  }
  const generated = script(repo, "sync-adapters.mjs");
  assert.equal(generated.status, 0, generated.output);
  return repo;
}

function writeSkill(repo, name, description, extraFiles = {}) {
  const files = { "SKILL.md": `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`, ...extraFiles };
  for (const [file, content] of Object.entries(files)) {
    const path = join(repo, "agent-team/skills", name, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

// Ten folded lines; a harness reads them joined with single spaces, `length` characters in all.
function foldedDescription(length) {
  const lines = [...Array(9).fill("x".repeat(100)), "x".repeat(length - 9 * 100 - 9)];
  return `>-\n${lines.map((line) => `  ${line}`).join("\n")}`;
}

function checkEmptyLeftoverFolderIsReportedThenRemoved() {
  const repo = makeRepo();
  mkdirSync(join(repo, ".codex/skills/retired-skill/references"), { recursive: true });
  const stale = script(repo, "sync-adapters.mjs", "--check");
  assert.equal(stale.status, 1, stale.output);
  assert.match(stale.output, /\.codex\/skills\/retired-skill\//);
  const fixed = script(repo, "sync-adapters.mjs");
  assert.equal(fixed.status, 0, fixed.output);
  assert.equal(existsSync(join(repo, ".codex/skills/retired-skill")), false, "the empty leftover folder is removed");
  assert.equal(script(repo, "sync-adapters.mjs", "--check").status, 0);
}

function checkFolderWithFilesButNoSkillIsReportedAndKept() {
  const repo = makeRepo();
  const notes = join(repo, ".claude/skills/draft-notes/notes.md");
  mkdirSync(dirname(notes), { recursive: true });
  writeFileSync(notes, "someone's draft\n");
  for (const args of [["--check"], []]) {
    const run = script(repo, "sync-adapters.mjs", ...args);
    assert.equal(run.status, 1, `sync-adapters ${args.join(" ")}\n${run.output}`);
    assert.match(run.output, /\.claude\/skills\/draft-notes\//);
  }
  assert.equal(readFileSync(notes, "utf8"), "someone's draft\n", "a file the script did not generate is never deleted");
}

function checkRetiredSkillLeavesNoFolder() {
  const repo = makeRepo();
  writeSkill(repo, "short-lived", "A skill that is added and then retired.", { "references/detail.md": "detail\n" });
  assert.equal(script(repo, "sync-adapters.mjs").status, 0);
  for (const target of SKILL_TARGETS) assert.ok(existsSync(join(repo, target, "short-lived/references/detail.md")), `${target} got the skill`);
  rmSync(join(repo, "agent-team/skills/short-lived"), { recursive: true });
  const run = script(repo, "sync-adapters.mjs");
  assert.equal(run.status, 0, run.output);
  for (const target of SKILL_TARGETS) assert.equal(existsSync(join(repo, target, "short-lived")), false, `${target}/short-lived is removed, not left behind empty`);
  assert.equal(script(repo, "sync-adapters.mjs", "--check").status, 0);
}

function checkDescriptionLimit() {
  const repo = makeRepo();
  writeSkill(repo, "long-description", foldedDescription(1025));
  assert.equal(script(repo, "sync-adapters.mjs").status, 0);
  const tooLong = script(repo, "validate-team.mjs");
  assert.equal(tooLong.status, 1, tooLong.output);
  assert.match(tooLong.output, /1025 chars.*long-description/);
  writeSkill(repo, "long-description", foldedDescription(1024));
  assert.equal(script(repo, "sync-adapters.mjs").status, 0);
  const atLimit = script(repo, "validate-team.mjs");
  assert.equal(atLimit.status, 0, atLimit.output);
}

function checkPortableProjectEntrypoints() {
  const read = (path) => readFileSync(join(root, path), "utf8");
  const guide = read("AGENTS.md");
  assert.match(guide, /explicitly read [`\[]?META-HARNESS\.md/, "the canonical entry must discover the portable harness");
  assert.match(guide, /unavailable[\s\S]*manually/i, "an unavailable harness must have an honest manual fallback");
  const base = read("agent-team/prompts/_base.md");
  assert.match(base, /read[\s\S]*AGENTS\.md[\s\S]*META-HARNESS\.md/, "every generated specialist must name both governing entry files");
  assert.match(base, /missing capability[\s\S]*NOT RUN/, "unavailable tools must not become claimed execution");
  for (const path of [".github/copilot-instructions.md", ".cursor/rules/meta-harness.mdc", "GEMINI.md"]) {
    const pointer = read(path);
    for (const target of ["AGENTS.md", "META-HARNESS.md", "progress.md"]) assert.ok(pointer.includes(target), `${path} routes to ${target}`);
    assert.doesNotMatch(pointer, /[A-Za-z]:[\\/]|\/Users\/|\/home\//, `${path} must not publish a private device installation path`);
    assert.ok(pointer.split(/\r?\n/).length <= 15, `${path} remains a pointer, not duplicate policy`);
  }
  assert.match(read(".cursor/rules/meta-harness.mdc"), /^---\r?\n[\s\S]*alwaysApply: true\r?\n---/);
}

function checkPlaywrightDiscoversExistingSuite() {
  const prompt = readFileSync(join(root, "agent-team/prompts/playwright-tester.md"), "utf8");
  assert.ok(existsSync(join(root, "frontend/playwright.config.ts")), "the regression targets a repository with an existing config");
  assert.doesNotMatch(prompt, /currently has no Playwright suite|not-applicable.*introduce one/i, "a stale absence claim must not skip an existing suite");
  assert.match(prompt, /[Dd]iscover[\s\S]*configuration[\s\S]*specs/);
  assert.match(prompt, /NOT RUN[\s\S]*actual missing prerequisite/, "report a real capability gap instead of assuming no tests exist");
  assert.match(prompt, /Never target production or guess credentials/, "preserve safe execution boundaries");
}

const checks = [
  checkEmptyLeftoverFolderIsReportedThenRemoved,
  checkFolderWithFilesButNoSkillIsReportedAndKept,
  checkRetiredSkillLeavesNoFolder,
  checkDescriptionLimit,
  checkPortableProjectEntrypoints,
  checkPlaywrightDiscoversExistingSuite,
];
const failed = [];
try {
  for (const check of checks) {
    try {
      check();
      process.stdout.write(`ok   ${check.name}\n`);
    } catch (error) {
      failed.push(check.name);
      process.stdout.write(`FAIL ${check.name}\n${error.message}\n`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
if (failed.length) process.exit(1);
process.stdout.write("sync-adapters and validate-team tests passed.\n");
