import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function toStatusLabel({ passed, healCount }) {
  if (!passed) return "❌ Failed";
  if (healCount > 0) return "⚠️ Healed";
  return "✅ Passed";
}

export async function writeHumanSummary({
  storyName,
  userStoryText,
  stepsPerformed,
  heals,
  finalScreenshotPath,
  passed,
  outputDir = path.resolve(process.cwd(), "reports"),
}) {
  await mkdir(outputDir, { recursive: true });
  const heal = heals[0];
  const markdown = [
    `# 🧪 Test Execution Summary: ${storyName}`,
    `**Status:** ${toStatusLabel({ passed, healCount: heals.length })}`,
    "",
    "### 📝 User Story",
    `> ${userStoryText}`,
    "",
    "### 🚀 Steps Performed",
    ...stepsPerformed.map((step, index) => {
      const icon = step.status === "healed" ? "🛠 **Healed**" : step.status === "failed" ? "❌ Failed" : "✅ Success";
      const reason = step.reason ? ` (${step.reason})` : "";
      return `${index + 1}. ${step.name} - ${icon}${reason}`;
    }),
    "",
    "### 🧠 Intelligence Applied (Self-Healing)",
    `- **Original Selector:** \`${heal?.oldSelector || "N/A"}\``,
    `- **New Selector:** \`${heal?.newSelector || "N/A"}\``,
    `- **Reason:** ${heal?.reason || "No heal needed."}`,
    "",
    "### 📸 Evidence",
    `![Final State](${finalScreenshotPath})`,
    "",
  ].join("\n");

  const fileName = `${Date.now().toString(36)}-${String(storyName || "story")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60)}.md`;

  const reportPath = path.resolve(outputDir, fileName);
  await writeFile(reportPath, markdown, "utf8");
  return reportPath;
}
