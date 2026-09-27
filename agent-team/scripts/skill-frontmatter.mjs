// The Agent Skills specification caps a skill's description at 1024 characters.
export const SKILL_DESCRIPTION_LIMIT = 1024;

export const skillFrontMatter = (source) => source.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? null;

// The description as a harness reads it: a folded (`>-`) block is joined with single spaces.
export function skillDescription(source) {
  const front = skillFrontMatter(source) ?? "";
  const folded = front.match(/^description:\s*>-?\n((?:[ \t]+.*\n?)+)/m);
  if (folded) return folded[1].split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  return (front.match(/^description:\s*(.*)$/m)?.[1] || "").trim();
}
