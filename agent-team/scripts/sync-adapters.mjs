import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { skillDescription } from "./skill-frontmatter.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const normalizeLineEndings = (value) => value.replace(/\r\n/g, "\n");
const manifest = JSON.parse(readFileSync(join(root, "agent-team/agents.json"), "utf8"));
const base = normalizeLineEndings(readFileSync(join(root, "agent-team/prompts/_base.md"), "utf8")).trim();
const check = process.argv.includes("--check");
const changed = [];
const expected = new Set();
const quote = (value) => JSON.stringify(value);
const tomlBody = (value) => value.replaceAll('"""', '\\"\\"\\"');
const yamlArray = (values) => `[${values.map(quote).join(", ")}]`;

function emit(relativePath, content) {
  relativePath = relativePath.replaceAll("\\", "/");
  expected.add(relativePath);
  const path = join(root, relativePath);
  let current = null;
  try { current = readFileSync(path, "utf8"); } catch {}
  content = normalizeLineEndings(content);
  if (current !== null && normalizeLineEndings(current) === content) return;
  changed.push(relativePath);
  if (check) return;
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content, "utf8");
  try { renameSync(temporary, path); } finally { rmSync(temporary, { force: true }); }
}

function removeOrphanedGeneratedFiles(directory, suffix) {
  const absolute = join(root, directory);
  let names = [];
  try { names = readdirSync(absolute); } catch { return; }
  for (const name of names.filter((value) => value.endsWith(suffix))) {
    const relativePath = `${directory}/${name}`;
    if (expected.has(relativePath)) continue;
    const content = readFileSync(join(root, relativePath), "utf8");
    if (!content.includes("Generated from source")) continue;
    changed.push(relativePath);
    if (!check) unlinkSync(join(root, relativePath));
  }
}

for (const agent of manifest.agents) {
  const role = normalizeLineEndings(readFileSync(join(root, "agent-team", agent.prompt), "utf8")).trim();
  const prompt = `${base}\n\n## Role-specific instructions\n\n${role}`;
  const teamWarning = agent.teamEligible === false
    ? "\n\nDo not use this role as a Claude agent-team teammate. Use it as a normal subagent or isolated session so its permission and worktree controls apply."
    : "";
  const claudePrompt = `${prompt}${teamWarning}`;
  const sourceHash = createHash("sha256").update(JSON.stringify(agent)).update("\0").update(prompt).digest("hex").slice(0, 16);
  const codexMcp = agent.id === "docs-researcher"
    ? '\n[mcp_servers.openaiDeveloperDocs]\nurl = "https://developers.openai.com/mcp"\n'
    : "";
  const codex = `# Generated from source ${sourceHash}. Edit agent-team/, not this file.\nname = ${quote(agent.codexName)}\ndescription = ${quote(agent.description)}\nmodel_reasoning_effort = ${quote(agent.effort)}\n${agent.access === "read-only" ? 'sandbox_mode = "read-only"\n' : ""}developer_instructions = \"\"\"\n${tomlBody(prompt)}\n\"\"\"\n${codexMcp}`;
  emit(`.codex/agents/${agent.id}.toml`, codex);

  const claudeMcp = agent.id === "docs-researcher" ? "mcpServers:\n  - openaiDeveloperDocs\n" : "";
  const claude = `---\nname: team-${agent.id}\ndescription: ${quote(agent.description)}\ntools: ${yamlArray(agent.claudeTools)}\n${agent.access === "read-only" ? 'disallowedTools: ["Edit", "Write"]\n' : ""}${claudeMcp}model: inherit\neffort: ${agent.effort}\npermissionMode: ${agent.access === "read-only" ? "plan" : "default"}\n${agent.access === "workspace-write" ? "isolation: worktree\n" : ""}---\n\n<!-- Generated from source ${sourceHash}. Edit agent-team/, not this file. -->\n\n${claudePrompt}\n`;
  emit(`.claude/agents/team-${agent.id}.md`, claude);

  const copilotMcp = agent.id === "docs-researcher"
    ? 'mcp-servers:\n  openaiDeveloperDocs:\n    type: http\n    url: "https://developers.openai.com/mcp"\n    tools: ["*"]\n'
    : "";
  const copilot = `---\nname: ${quote(`Business OS ${agent.id.replaceAll("-", " ")}`)}\ndescription: ${quote(agent.description)}\ntools: ${yamlArray(agent.copilotTools)}\n${copilotMcp}---\n\n<!-- Generated from source ${sourceHash}. Edit agent-team/, not this file. -->\n\n${prompt}\n`;
  emit(`.github/agents/${agent.id}.agent.md`, copilot);
}

removeOrphanedGeneratedFiles(".codex/agents", ".toml");
removeOrphanedGeneratedFiles(".claude/agents", ".md");
removeOrphanedGeneratedFiles(".github/agents", ".agent.md");

const SKILL_TARGETS = [".agents/skills", ".claude/skills", ".github/skills"];
const RETIRED_SKILL_TARGETS = [".codex/skills"];
const GENERATED_SKILL_MARK = "Generated from agent-team/skills/";
const skillsRoot = join(root, "agent-team/skills");
const skillNames = readdirSync(skillsRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

function filesUnder(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(join(directory, entry.name), relative) : [relative];
  });
}

// The topmost folders under `directory` that hold no file at any depth.
function emptyFoldersUnder(directory, prefix) {
  return readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isDirectory()).flatMap((entry) => {
    const folder = join(directory, entry.name);
    return filesUnder(folder).length ? emptyFoldersUnder(folder, `${prefix}/${entry.name}`) : [`${prefix}/${entry.name}/`];
  });
}

// rmdir refuses a folder that holds anything, so this never deletes a file.
function removeEmptyFolders(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyFolders(join(directory, entry.name));
  }
  if (readdirSync(directory).length === 0) rmdirSync(directory);
}

const indexRows = [];
for (const skillName of skillNames) {
  const skillDir = join(skillsRoot, skillName);
  const source = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  indexRows.push(`| [${skillName}](${skillName}/SKILL.md) | ${skillDescription(source).replaceAll("|", "\\|")} |`);
  for (const file of filesUnder(skillDir)) {
    const raw = readFileSync(join(skillDir, file), "utf8");
    const content = file === "SKILL.md"
      ? raw.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, `$1\n<!-- ${GENERATED_SKILL_MARK}${skillName}/SKILL.md. -->\n`)
      : raw;
    for (const target of SKILL_TARGETS) emit(`${target}/${skillName}/${file}`, content);
  }
}
emit("agent-team/skills/INDEX.md", `# Skill index\n\nGenerated by agent-team/scripts/sync-adapters.mjs from agent-team/skills/*/SKILL.md. Start with **work-mode**; read this list before creating a skill (see skill-wiki).\n\n| Skill | Use when |\n|---|---|\n${indexRows.join("\n")}\n`);

const foldersWithoutSkill = [];
for (const target of [...SKILL_TARGETS, ...RETIRED_SKILL_TARGETS]) {
  let names = [];
  try { names = readdirSync(join(root, target), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
  for (const name of names) {
    const dir = join(root, target, name);
    let content = null;
    try { content = readFileSync(join(dir, "SKILL.md"), "utf8"); } catch {}
    if (content === null) {
      // No harness loads a folder without SKILL.md. An empty one is left over from a retired skill; one that
      // still holds files was not generated here, so it is reported and never deleted.
      if (filesUnder(dir).length) {
        foldersWithoutSkill.push(`${target}/${name}/`);
        continue;
      }
      changed.push(`${target}/${name}/`);
      if (!check) removeEmptyFolders(dir);
      continue;
    }
    if (!content.includes(GENERATED_SKILL_MARK)) continue;
    changed.push(...emptyFoldersUnder(dir, `${target}/${name}`));
    for (const file of filesUnder(dir)) {
      const relativePath = `${target}/${name}/${file}`;
      if (expected.has(relativePath)) continue;
      changed.push(relativePath);
      if (!check) unlinkSync(join(dir, file));
    }
    if (!check) removeEmptyFolders(dir);
  }
}

const bullets = (paths) => paths.map((path) => `- ${path}`).join("\n");
if (check && changed.length) {
  process.stderr.write(`Generated agent adapters are stale:\n${bullets(changed)}\nRun: node agent-team/scripts/sync-adapters.mjs\n`);
}
if (foldersWithoutSkill.length) {
  process.stderr.write(`Skill folders without a SKILL.md still hold files. They were not generated here, so nothing in them was deleted:\n${bullets(foldersWithoutSkill)}\nMove each into agent-team/skills/<name>/ and rerun, or delete it by hand.\n`);
}
if (!check && changed.length) process.stdout.write(`Updated ${changed.length} generated paths.\n`);
if ((check && changed.length) || foldersWithoutSkill.length) process.exit(1);
if (!changed.length) process.stdout.write("Agent adapters are synchronized.\n");
