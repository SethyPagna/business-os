import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

for (const skillName of ["orchestrate-team", "repo-patterns"]) {
  const source = readFileSync(join(root, `agent-team/skills/${skillName}/SKILL.md`), "utf8");
  for (const target of [".codex/skills", ".claude/skills", ".github/skills"]) {
    const content = source.replace(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/, `$1\n<!-- Generated from agent-team/skills/${skillName}/SKILL.md. -->\n`);
    emit(`${target}/${skillName}/SKILL.md`, content);
  }
}

if (check && changed.length) {
  process.stderr.write(`Generated agent adapters are stale:\n${changed.map((path) => `- ${path}`).join("\n")}\nRun: node agent-team/scripts/sync-adapters.mjs\n`);
  process.exit(1);
}
process.stdout.write(changed.length ? `${check ? "Stale" : "Updated"} ${changed.length} generated files.\n` : "Agent adapters are synchronized.\n");
