import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function generatePlaywrightTest({ plan, targetFile = path.resolve(process.cwd(), "tests", "generated-story.spec.js") }) {
  await mkdir(path.dirname(targetFile), { recursive: true });
  const storyName = String(plan.storyName || "Generated Story").replace(/'/g, "\\'");
  const safePlan = JSON.stringify(plan, null, 2);

  const fileContent = `import { test } from '@playwright/test';
import { SelectorRegistry } from '../src/registry/selector-registry.mjs';
import { OpenClawAgentClient } from '../src/agent/openclaw-agent-client.mjs';
import { VisionHealer } from '../src/healing/vision-healer.mjs';
import { StoryPage } from '../src/pom/story-page.mjs';

const plan = ${safePlan};
const storyName = '${storyName}';
const actionDelayMs = Math.max(0, Number(process.env.QA_ORACLE_ACTION_DELAY_MS || 0));
const verboseStepLogs = String(process.env.QA_ORACLE_VERBOSE_STEP_LOGS || 'true').toLowerCase() === 'true';
const renderTarget = (target) => JSON.stringify(target || {}).slice(0, 220);

test.describe(storyName, () => {
  test(storyName, async ({ page }) => {
    const selectorRegistry = new SelectorRegistry(process.env.QA_ORACLE_SELECTOR_REGISTRY_FILE);
    const agentClient = new OpenClawAgentClient({ agentId: process.env.QA_ORACLE_AGENT_ID || 'qa-oracle' });
    const visionHealer = new VisionHealer({ agentClient, selectorRegistry });
    const storyPage = new StoryPage({ page, selectorRegistry, visionHealer, storyName });
    const healEvents = [];

    for (const [idx, step] of plan.steps.entries()) {
      if (verboseStepLogs) {
        console.log(
          \`[QA-Oracle][Playwright][\${idx + 1}/\${plan.steps.length}] START \${step.name} action=\${String(step.action || '')} target=\${renderTarget(
            step.target,
          )}\`,
        );
      }
      const startedAt = Date.now();
      await test.step(step.name, async () => {
        await storyPage.runStep(step, healEvents);
      });
      if (verboseStepLogs) {
        console.log(\`[QA-Oracle][Playwright][\${idx + 1}/\${plan.steps.length}] DONE \${step.name} durationMs=\${Date.now() - startedAt}\`);
      }
      const stepDelayMs =
        Number.isFinite(Number(step?.delayMs)) && Number(step.delayMs) >= 0
          ? Math.floor(Number(step.delayMs))
          : actionDelayMs;
      if (stepDelayMs > 0) {
        await page.waitForTimeout(stepDelayMs);
      }
    }

    await visionHealer.savePassingScreenshot({ page, storyName });
  });
});
`;

  await writeFile(targetFile, fileContent, "utf8");
  return targetFile;
}
