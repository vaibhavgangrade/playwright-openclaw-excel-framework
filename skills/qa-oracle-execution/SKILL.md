---
name: qa-oracle-execution
description: Execute generated Playwright tests with trace, JSON report, and structured failure context for self-healing retries. Use when running or rerunning QA-Oracle story tests.
---

# QA-Oracle Execution Skill

Use `skill.js` from this folder to:
- run `npx playwright test` with `--trace on`
- capture JSON reporter output
- return distilled failure hints back to the planner/healer loop

## Contract
- Always return `llmFailureContext` when execution fails.
- Keep command output concise but preserve error messages like locator-not-found and timeout failures.
