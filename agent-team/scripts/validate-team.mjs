import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(join(root, "agent-team/agents.json"), "utf8"));
const ids = new Set();
const codexNames = new Set();
for (const agent of manifest.agents) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agent.id)) throw new Error(`Invalid portable id: ${agent.id}`);
  if (!/^[a-z0-9_]+$/.test(agent.codexName)) throw new Error(`Invalid Codex name: ${agent.codexName}`);
  if (ids.has(agent.id) || codexNames.has(agent.codexName)) throw new Error(`Duplicate agent: ${agent.id}`);
  if (!["read-only", "workspace-write"].includes(agent.access)) throw new Error(`Invalid access: ${agent.id}`);
  if (!["medium", "high"].includes(agent.effort)) throw new Error(`Invalid effort: ${agent.id}`);
  if (!agent.description || agent.description.length > 1024) throw new Error(`Description size invalid: ${agent.id}`);
  if (!Array.isArray(agent.claudeTools) || !Array.isArray(agent.copilotTools)) throw new Error(`Tool mapping missing: ${agent.id}`);
  const prompt = readFileSync(join(root, "agent-team", agent.prompt), "utf8");
  if (!prompt.trim() || prompt.length > 20000) throw new Error(`Prompt size invalid: ${agent.id}`);
  ids.add(agent.id);
  codexNames.add(agent.codexName);
}
for (const path of [".claude/settings.json", ".codex/hooks.json", ".mcp.json", "agent-team/capabilities.json", "agent-team/schemas/task-envelope.schema.json", "agent-team/schemas/result.schema.json"]) {
  JSON.parse(readFileSync(join(root, path), "utf8"));
}
const taskSchema = JSON.parse(readFileSync(join(root, "agent-team/schemas/task-envelope.schema.json"), "utf8"));
const schemaRoles = taskSchema.properties.role.enum || [];
if (schemaRoles.length !== ids.size || schemaRoles.some((id) => !ids.has(id))) throw new Error("Task-envelope role enum is out of sync with agent-team/agents.json");
for (const name of ["orchestrate-team", "repo-patterns"]) {
  const skill = readFileSync(join(root, `agent-team/skills/${name}/SKILL.md`), "utf8");
  const normalizedSkill = skill.replaceAll("\r\n", "\n");
  if (!normalizedSkill.startsWith("---\n") || !normalizedSkill.includes(`\nname: ${name}\n`) || !normalizedSkill.includes("\ndescription: ")) throw new Error(`Invalid portable skill: ${name}`);
}
execFileSync(process.execPath, [join(root, "agent-team/scripts/sync-adapters.mjs"), "--check"], { cwd: root, stdio: "inherit" });
process.stdout.write(`Agent team valid: ${manifest.agents.length} roles, 3 adapter targets, synchronized output.\n`);
