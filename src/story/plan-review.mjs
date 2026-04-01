import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function safeName(name) {
  return String(name || "story")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
}

function extractJsonFromMarkdown(raw) {
  const text = String(raw || "");
  const fenced = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  if (!fenced || !fenced[1]) return null;
  return fenced[1].trim();
}

export async function writePlanDraft({ plan, storyContext, targetDir }) {
  const dir = path.resolve(targetDir || path.resolve(process.cwd(), "artifacts", "plans"));
  await mkdir(dir, { recursive: true });
  const fileName = `${Date.now().toString(36)}-${safeName(plan?.storyName || storyContext?.title || "story")}.steps.md`;
  const planPath = path.resolve(dir, fileName);
  const markdown = [
    `# QA-Oracle Plan Draft: ${String(plan?.storyName || storyContext?.title || "Story").trim()}`,
    "",
    `- Generated at: ${new Date().toISOString()}`,
    `- Source story file: ${storyContext?.sourcePath || "N/A"}`,
    "",
    "## Review Notes",
    "- Edit steps below if needed before execution.",
    "- Supported actions: `goto`, `click`, `fill`, `press`, `assertVisible`, `assertUrlIncludes`.",
    "- Use env placeholders for secrets, e.g. `env:QA_USER`, `env:QA_PASSWORD`.",
    "- If multiple matching elements exist, set `target.index` (0-based). Example: 5th match => `index: 4`.",
    "",
    "## Human-Readable Steps",
    ...(Array.isArray(plan?.steps)
      ? plan.steps.map((step, idx) => {
          const target = step?.target ? `target=${JSON.stringify(step.target)}` : "target=N/A";
          const value = typeof step?.value !== "undefined" ? `, value=${JSON.stringify(step.value)}` : "";
          return `${idx + 1}. ${step?.name || "Unnamed"} [action=${step?.action || "N/A"}, ${target}${value}]`;
        })
      : ["1. No steps found"]),
    "",
    "## Executable Plan JSON",
    "```json",
    JSON.stringify({ plan }, null, 2),
    "```",
    "",
  ].join("\n");
  await writeFile(planPath, markdown, "utf8");
  return planPath;
}

export async function readPlanDraft(planPath) {
  const raw = await readFile(path.resolve(planPath), "utf8");
  const markdownJson = extractJsonFromMarkdown(raw);
  const parsed = JSON.parse(markdownJson || raw);
  if (parsed?.plan && Array.isArray(parsed.plan.steps)) return parsed.plan;
  if (Array.isArray(parsed?.steps)) return parsed;
  throw new Error("Plan draft is invalid. Expected Markdown with JSON code block containing `plan.steps` or raw JSON.");
}

export async function waitForManualApproval(planPath) {
  const rl = readline.createInterface({ input, output });
  try {
    // Loop allows user to edit, then re-approve.
    while (true) {
      const answer = await rl.question(
        [
          "",
          `[QA-Oracle] Plan draft created: ${planPath}`,
          "[QA-Oracle] Review/edit the file, then choose:",
          "  - approve: continue execution with current file",
          "  - reload: re-read file after edits",
          "  - abort: stop execution",
          "Enter choice (approve/reload/abort): ",
        ].join("\n"),
      );
      const choice = String(answer || "").trim().toLowerCase();
      if (choice === "abort") return { approved: false };
      if (choice === "approve") return { approved: true };
      if (choice === "reload") return { approved: true, reload: true };
      // keep asking on invalid input
    }
  } finally {
    rl.close();
  }
}
