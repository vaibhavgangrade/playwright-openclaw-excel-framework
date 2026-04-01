# Playwright + OpenClaw Self-Healing Framework

This repository now supports a **story-driven, non-Excel** workflow where a QA agent builds and heals Playwright automation from plain user stories.

## Core Architecture

- `agents/qa-oracle/agent.md`: QA-Oracle identity and mandatory behavior
- `src/orchestration/run-story.mjs`: orchestration loop (`Plan -> Code -> Execute -> Heal`)
- `src/story/story-planner.mjs`: user story to dynamic Gherkin-like plan
- `src/story/story-to-test.mjs`: dynamic test generation with `test.step`
- `src/pom/`: Page Object Model layer
- `src/healing/vision-healer.mjs`: visual fallback + confidence-scored heals
- `src/registry/selector-registry.mjs`: persistent selector memory
- `skills/qa-oracle-execution/skill.js`: Playwright execution wrapper and failure context pipe
- `skills/selector-registry/skill.js`: shared selector registry skill
- `src/reporting/human-summary.mjs`: layman-friendly Markdown summary

## What QA-Oracle Does

1. Accepts a user story (`--story`).
2. Decomposes it into internal Gherkin-style steps.
3. Generates Playwright code that uses `test.step(...)`.
4. Executes with trace + JSON logs.
5. On failures, self-heals locators and retries.
6. Persists healed locators (`oldSelector -> newSelector`) for future reuse.
7. Produces a human-readable report under `reports/`.

## Setup

```bash
cd "C:\VaibhavOpenSpec\OpenClaw\playwright-openclaw-excel-framework"
npm install
copy .env.example .env
```

Ensure OpenClaw gateway is running:

```bash
npx openclaw gateway run --port 18789 --verbose
```

## Run Story-Driven Flow

```bash
npm run run:story -- --story "As a shopper, I can add an item to cart and complete checkout"
```

Shortcuts:

```bash
npm run story -- test-config/qa-oracle.config.json ./stories/checkout.story.md --autoApprove true
npm run story:checkout
```

Optional flags:

- `--agent qa-oracle` (default)
- `--maxAttempts 3` (default)
- `--config test-config/qa-oracle.config.json` (default)
- `--storyFile ./stories/checkout.story.txt`
- `--engine openclaw-first|playwright-first`
- `--manualReview true|false` (default from config)
- `--autoApprove true` (for CI/non-interactive runs)

You can also pass story text without `--story`:

```bash
npm run run:story -- As a shopper I can login and reach checkout payment form
```

Use a story file (recommended for teams):

```bash
npm run run:story -- --config test-config/qa-oracle.config.json --storyFile ./stories/checkout.story.md
```

Run all story files in a directory (batch mode):

```bash
npm run run:stories -- --config test-config/qa-oracle.config.json --storiesDir ./stories --autoApprove true
```

Batch mode picks files ending with `.story.md`, `.story.markdown`, or `.story.txt` recursively under `--storiesDir`.

If you pass only a file path positionally, it is auto-detected:

```bash
npm run run:story -- ./stories/checkout.story.md
```

Plan-review workflow:
- Agent creates an executable plan review file under `artifacts/plans/*.steps.md`
- You can manually edit the steps file before execution
- In manual mode, runner waits for `approve/reload/abort` confirmation in CLI
- For CI pipelines, pass `--manualReview=false` or `--autoApprove=true`

Story file sections supported:
- `User Story`
- `Acceptance Criteria`
- `Test Data`
- `Notes`
- `Agent Steps` (optional JSON array of explicit steps)

Reusable story tokens from `Test Data`:
- Add key-value pairs in `Test Data` (example: `baseUrl: https://www.amazon.com`, `cartUrl: https://www.amazon.com/gp/cart/view.html?ref_=nav_cart`).
- Reference them inside `Acceptance Criteria` using `{{tokenName}}`:
  - `Navigate to {{baseUrl}}`
  - `Navigate to {{cartUrl}}`
- Reusable index for Add-to-Cart flows:
  - Define `addToCartIndex: 2` in `Test Data` (1-based index for humans).
  - Use `Add item to cart` in criteria; planner maps it to `target.index: 1` internally.

Conditional auth keywords in plain English are supported:
- `If the user is already authenticated, skip login...`
- `If the user is not authenticated, login...`
- Optional explicit OR rules:
  - `Authenticated indicators: Account OR Profile OR Sign Out`
  - `Unauthenticated indicators: Sign in OR Login`
 - Natural phrase form is also supported:
   - `If unauthenticated indicator is present (Hello, Sign in OR Sign in OR Login), perform login.`

Fail-fast safety:
- If conditional login wording is present but no indicators are parsed, execution stops with a clear error instead of guessing.

The loader passes these sections as structured context to the planner so actions are inferred from the file instead of command-line text alone.

If remote planner output is unavailable, the framework now builds deterministic fallback steps from story context keywords (login/cart/checkout/payment) and configured base URL.
When story text includes an explicit navigation URL (for example: `Navigate to https://www.amazon.com`), fallback planning prioritizes that URL over `context.baseUrl`.

Default mode is plain-English only (`User Story`, `Acceptance Criteria`, `Test Data`) and the agent generates executable steps automatically.

`Agent Steps` is an optional power-user override for cases where teams want deterministic control for specific flows.

Debug in headed mode (see live browser):

- PowerShell:
  - `$env:PW_HEADED="1"; $env:PW_SLOWMO="250"; node src/orchestration/run-story.mjs test-config/qa-oracle.config.json ./stories/checkout.story.md`
- CMD:
  - `set PW_HEADED=1 && set PW_SLOWMO=250 && node src/orchestration/run-story.mjs test-config/qa-oracle.config.json ./stories/checkout.story.md`

Locator strategy is retailer-agnostic by default:
- Accessibility-first (`role`, `label`, `placeholder`, `text`)
- Generic semantic token fallbacks from step intent (no site/vendor-specific IDs in core)
- Vision healer + selector registry for adaptive self-healing and memory
- Multi-match support with `target.index` (0-based), e.g. `index: 4` for "5th Add to cart"

Execution engine:
- `openclaw-first` (default): executes steps in OpenClaw managed browser first, then falls back to Playwright if needed.
- `playwright-first`: executes with Playwright first (legacy behavior).
- `openclaw-first` now runs a startup preflight (`browser status`) and fails fast with a clear message if gateway/profile is unreachable.
- `execution.openclawStrict: true` disables Playwright fallback; run fails if OpenClaw-first fails.
- `execution.actionDelayMs` adds a small delay between steps (applies to both OpenClaw and Playwright execution paths).
- You can override delay per step with `delayMs` inside a plan step (for slower UI transitions like `Iframes`, `Pop-Up`, `New tab`).
- `execution.intentMode: "agent-first-safe"` enables intent-driven acceptance-criteria planning with guaranteed fallback to safe deterministic planning if agent output is unavailable.
- `execution.verboseStepLogs: true` prints step-level START/DONE/FAIL logs with action and target details for OpenClaw and Playwright paths.

OpenClaw session/cookie bootstrap (helps avoid login/passkey prompts):
- Keep a stable profile in config: `execution.openclawProfile`.
- Optional clear stale cookies at launch: `execution.openclawClearCookiesOnStart`.
- Optional seed cookies before step execution:
  - `execution.openclawBootstrapCookies: [{ "name": "...", "value": "env:COOKIE_ENV", "url": "https://your-site.com" }]`
- Cookie values support env placeholders (`env:VAR`, `${VAR}`, `$VAR`, `{{VAR}}`).
- Optional live AI element resolution (more agentic for click/fill):
  - `execution.openclawLiveAiActionResolution: true`
  - On each click/fill, OpenClaw captures an interactive snapshot and asks the QA agent to pick a ref, then executes with that ref before deterministic fallback.

## Universal Team Setup (Any Project)

1. Copy this framework folder into the target repo (or publish as an internal package).
2. Create a project-specific `test-config/qa-oracle.config.json`.
3. Keep secrets in `.env` (`QA_USER`, `QA_PASSWORD`) instead of story text.
4. Run the same command in every project:

```bash
npm run run:story -- --config test-config/qa-oracle.config.json --story "As a user ..."
```

Team convention recommendation:
- One config per app/environment:
  - `qa-oracle.web.qa.json`
  - `qa-oracle.web.staging.json`
  - `qa-oracle.mobile-web.qa.json`

Important:
- No hardcoded URLs/selectors are used as fallback now.
- Set `context.baseUrl` in your config before execution.
- If planner output is unavailable and no safe fallback exists, the run fails fast with a clear message.
- Credential values should be referenced as env placeholders in plan steps:
  - `env:QA_USER`
  - `env:QA_PASSWORD`
  - `${QA_USER}` / `${QA_PASSWORD}`
  - `$QA_USER` / `$QA_PASSWORD`
  - `{{QA_USER}}` / `{{QA_PASSWORD}}`

## Outputs

- Generated test: `tests/generated-story.spec.js`
- Selector memory: `artifacts/selector-registry.json`
- Test evidence: `artifacts/evidence/`
- Human summary: `reports/*.md`
- Playwright execution JSON: `artifacts/execution/*.json`

## Legacy Excel Runner (Optional)

Excel flow remains available for compatibility:

```bash
npm run test:excel
```
