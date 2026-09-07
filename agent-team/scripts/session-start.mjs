import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const run = (script, args = []) => execFileSync(process.execPath, [resolve(root, script), ...args], { cwd: root, encoding: "utf8" }).trim();
let sync;
try {
  sync = run("agent-team/scripts/sync-adapters.mjs", ["--check"]);
} catch (error) {
  sync = `WARNING: generated adapters are stale. Run node agent-team/scripts/sync-adapters.mjs. ${String(error.stderr || error.message).trim()}`;
}
const cachePath = run("agent-team/scripts/mine-git-history.mjs");
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: `${sync} Shared agent definitions are in agent-team/. Git-pattern cache: ${cachePath}. Use the smallest useful team and one writer per path.`
  }
}));
