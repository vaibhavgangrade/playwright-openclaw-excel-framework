import { test } from '@playwright/test';
import { SelectorRegistry } from '../src/registry/selector-registry.mjs';
import { OpenClawAgentClient } from '../src/agent/openclaw-agent-client.mjs';
import { VisionHealer } from '../src/healing/vision-healer.mjs';
import { StoryPage } from '../src/pom/story-page.mjs';

const plan = {
  "storyName": "Walmart Checkout Flow",
  "gherkin": [
    {
      "type": "Given",
      "text": "the user is on the target application page"
    },
    {
      "type": "When",
      "text": "the user performs intent-driven actions from acceptance criteria"
    },
    {
      "type": "Then",
      "text": "the expected outcome should be visible"
    }
  ],
  "steps": [
    {
      "name": "Navigate to https://www.walmart.com/",
      "action": "goto",
      "target": {
        "type": "url",
        "value": "https://www.walmart.com/"
      },
      "value": "",
      "runWhen": "always",
      "optional": false
    },
    {
      "name": "Search for ipad green yellow blue",
      "action": "fill",
      "target": {
        "type": "role",
        "role": "searchbox",
        "name": "Search Walmart"
      },
      "value": "ipad green yellow blue",
      "runWhen": "always",
      "optional": false
    },
    {
      "name": "Submit search",
      "action": "press",
      "target": {
        "type": "text",
        "value": "Enter"
      },
      "value": "Enter",
      "runWhen": "always",
      "optional": false
    },
    {
      "name": "Add item to cart (2nd match)",
      "action": "click",
      "target": {
        "type": "role",
        "role": "button",
        "name": "Add to cart",
        "index": 1
      },
      "value": "",
      "runWhen": "always",
      "optional": false
    }
  ],
  "fallbackUsed": true,
  "intentModeUsed": "agent-first-safe"
};
const storyName = 'Walmart Checkout Flow';
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
          `[QA-Oracle][Playwright][${idx + 1}/${plan.steps.length}] START ${step.name} action=${String(step.action || '')} target=${renderTarget(
            step.target,
          )}`,
        );
      }
      const startedAt = Date.now();
      await test.step(step.name, async () => {
        await storyPage.runStep(step, healEvents);
      });
      if (verboseStepLogs) {
        console.log(`[QA-Oracle][Playwright][${idx + 1}/${plan.steps.length}] DONE ${step.name} durationMs=${Date.now() - startedAt}`);
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
