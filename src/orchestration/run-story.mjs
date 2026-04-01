import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { OpenClawAgentClient } from "../agent/openclaw-agent-client.mjs";
import { loadProjectConfig, toAbsolute } from "./project-config.mjs";
import { writeHumanSummary } from "../reporting/human-summary.mjs";
import { SelectorRegistry } from "../registry/selector-registry.mjs";
import { loadStoryFromFile } from "../story/story-file-loader.mjs";
import { readPlanDraft, waitForManualApproval, writePlanDraft } from "../story/plan-review.mjs";
import { buildDynamicPlan } from "../story/story-planner.mjs";
import { normalizeAndValidatePlan } from "../story/plan-validator.mjs";
import { generatePlaywrightTest } from "../story/story-to-test.mjs";
import { loadEnvFiles, parseArgs } from "../utils.mjs";
import { OpenClawFirstExecutor } from "./openclaw-first-executor.mjs";
import { OpenClawClient, readOpenClawConfig } from "../openclaw-client.mjs";
import { runExecutionSkill } from "../../skills/qa-oracle-execution/skill.js";

const TAG = "[QA-Oracle]";

function normalizeExecutionEngine(rawEngine) {
  const value = String(rawEngine || "").trim().toLowerCase();
  if (!value) return { engine: "openclaw-first", isHybridAlias: false };
  if (value === "openclaw-first" || value === "playwright-first") {
    return { engine: value, isHybridAlias: false };
  }
  if (value === "openclaw-playwright-hybrid" || value === "hybrid" || value === "openclaw-hybrid") {
    return { engine: "openclaw-first", isHybridAlias: true };
  }
  return { engine: "openclaw-first", isHybridAlias: false, unknownInput: value };
}

function normalizeForwardedArgs(rawArgs) {
  const args = { ...rawArgs };
  const positional = Array.isArray(args._) ? [...args._] : [];

  const looksLikeConfig = (value) => /\.json$/i.test(String(value || "").trim());
  const looksLikeStoryFile = (value) => /\.(md|markdown|txt|story)$/i.test(String(value || "").trim());

  // Handles npm/PowerShell cases where "--config foo --storyFile bar"
  // arrives as plain positional args: "foo bar".
  if (!args.config && positional[0] && looksLikeConfig(positional[0])) {
    args.config = positional.shift();
  }
  if (!args.storyFile && positional[0] && looksLikeStoryFile(positional[0])) {
    args.storyFile = positional.shift();
  }

  args._ = positional;
  return args;
}

async function readStoryInput(args) {
  const storyContext = {
    source: "inline",
    sourcePath: "",
    title: "",
    userStory: "",
    acceptanceCriteria: "",
    testData: "",
    testDataMap: {},
    notes: "",
    authRules: { authenticatedAny: [], unauthenticatedAny: [] },
    agentSteps: [],
  };
  const direct = String(args.story || "").trim();
  if (direct) {
    return { userStoryText: direct, storyContext };
  }
  const storyFile = String(args.storyFile || "").trim();
  if (storyFile) {
    const loaded = await loadStoryFromFile(storyFile);
    return {
      userStoryText: loaded.combinedText,
      storyContext: {
        source: "file",
        sourcePath: loaded.sourcePath,
        title: loaded.title,
        userStory: loaded.userStory,
        acceptanceCriteria: loaded.acceptanceCriteria,
        testData: loaded.testData,
        testDataMap: loaded.testDataMap || {},
        notes: loaded.notes,
        authRules: loaded.authRules,
        agentSteps: loaded.agentSteps,
      },
    };
  }
  const positionalItems = Array.isArray(args._) ? args._ : [];
  const positional = positionalItems.join(" ").trim();
  if (positional) {
    const maybeFile = positionalItems.length === 1 ? positionalItems[0] : "";
    if (maybeFile && /\.(md|markdown|txt|story)$/i.test(maybeFile)) {
      const loaded = await loadStoryFromFile(maybeFile);
      return {
        userStoryText: loaded.combinedText,
        storyContext: {
          source: "file",
          sourcePath: loaded.sourcePath,
          title: loaded.title,
          userStory: loaded.userStory,
          acceptanceCriteria: loaded.acceptanceCriteria,
          testData: loaded.testData,
          testDataMap: loaded.testDataMap || {},
          notes: loaded.notes,
          authRules: loaded.authRules,
          agentSteps: loaded.agentSteps,
        },
      };
    }
    return { userStoryText: positional, storyContext };
  }
  throw new Error('Missing user story. Use --story, --storyFile, or pass positional text.');
}

function describeAction(step) {
  const action = String(step.action || "").toLowerCase();
  if (action === "goto") return `${step.name} (opened ${step.target?.value || step.value || "target URL"})`;
  if (action === "fill") return `${step.name} (entered required details)`;
  if (action === "click") return `${step.name} (clicked target control)`;
  if (action.startsWith("assert")) return `${step.name} (verified expected result)`;
  return step.name || action;
}

async function ensureWorkspaceArtifacts(pathsConfig) {
  await mkdir(toAbsolute(pathsConfig, pathsConfig.artifactsDir), { recursive: true });
  await mkdir(toAbsolute(pathsConfig, pathsConfig.reportsDir), { recursive: true });
  await mkdir(toAbsolute(pathsConfig, pathsConfig.testsDir), { recursive: true });
  await mkdir(toAbsolute(pathsConfig, pathsConfig.evidenceDir), { recursive: true });
}

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function assertOpenClawGatewayReady({ profile }) {
  const cfg = await readOpenClawConfig().catch(() => null);
  const token = String(cfg?.gateway?.auth?.token || "").trim();
  if (!token) {
    throw new Error(
      'OpenClaw preflight failed: missing gateway token in ~/.openclaw/openclaw.json. Run "npx openclaw login" first.',
    );
  }
  const client = new OpenClawClient(process.cwd(), token, profile);
  const status = await client.browser(["status"], { timeoutMs: 18000 });
  if (!status.ok) {
    const detail = String(status.stderr || status.stdout || "unknown status error").slice(0, 500);
    throw new Error(
      `OpenClaw preflight failed: gateway/browser not reachable for profile "${profile}". Detail: ${detail}. Start gateway via "npx openclaw gateway run --port 18789 --verbose".`,
    );
  }
}

async function main() {
  await loadEnvFiles();
  const args = normalizeForwardedArgs(parseArgs(process.argv));
  const { config, configPath } = await loadProjectConfig(args.config);
  const maxAttempts = Math.max(1, Number(args.maxAttempts || config.maxAttempts || 3));
  const requestedEngine = String(args.engine || config?.execution?.engine || "openclaw-first").trim().toLowerCase();
  const engineNormalized = normalizeExecutionEngine(requestedEngine);
  const executionEngine = engineNormalized.engine;
  const openclawStrictArgProvided = typeof args.openclawStrict !== "undefined";
  const openclawStrictDefault =
    String(args.openclawStrict ?? config?.execution?.openclawStrict ?? "false").trim().toLowerCase() === "true";
  const openclawStrict = engineNormalized.isHybridAlias && !openclawStrictArgProvided ? false : openclawStrictDefault;
  const manualReview =
    String(args.manualReview ?? config?.execution?.manualReview ?? "false").trim().toLowerCase() !== "false";
  const autoApprove = String(args.autoApprove ?? "false").trim().toLowerCase() === "true";
  const { userStoryText, storyContext } = await readStoryInput(args);
  const startedAt = Date.now();

  if (
    storyContext?.source === "file" &&
    storyContext?.authRules?.conditionalAuthDetected &&
    (!Array.isArray(storyContext?.authRules?.authenticatedAny) || storyContext.authRules.authenticatedAny.length === 0) &&
    (!Array.isArray(storyContext?.authRules?.unauthenticatedAny) || storyContext.authRules.unauthenticatedAny.length === 0)
  ) {
    throw new Error(
      'Conditional login detected in story, but no auth indicators were parsed. Add lines like "Authenticated indicators: Account OR Profile OR Sign Out" or "If unauthenticated indicator is present (...), perform login."',
    );
  }

  const effectiveConfigPath =
    configPath || path.resolve(process.cwd(), String(args.config || "test-config/qa-oracle.config.json"));
  console.log(
    `${TAG} Effective args -> config="${effectiveConfigPath}", storySource="${storyContext.source}", storyFile="${
      storyContext.sourcePath || "N/A"
    }", agent="${String(args.agent || config.agentId || "qa-oracle")}", maxAttempts=${maxAttempts}, engine="${executionEngine}", manualReview=${
      manualReview ? "yes" : "no"
    }, baseUrlConfigured=${
      Boolean(String(config?.context?.baseUrl || "").trim()) ? "yes" : "no"
    }`,
  );
  if (engineNormalized.isHybridAlias) {
    console.log(`${TAG} Engine alias "${requestedEngine}" mapped to "openclaw-first" with Playwright fallback enabled.`);
  }
  if (engineNormalized.unknownInput) {
    console.log(`${TAG} Unknown engine "${engineNormalized.unknownInput}". Falling back to "openclaw-first".`);
  }

  if (executionEngine === "openclaw-first") {
    const profile = String(config?.execution?.openclawProfile || "openclaw");
    await assertOpenClawGatewayReady({ profile });
    console.log(`${TAG} OpenClaw preflight passed for profile "${profile}".`);
  }

  await ensureWorkspaceArtifacts(config.paths);

  process.env.QA_ORACLE_SELECTOR_REGISTRY_FILE = toAbsolute(config, config.paths.selectorRegistryFile);
  process.env.QA_ORACLE_EVIDENCE_DIR = toAbsolute(config, config.paths.evidenceDir);
  process.env.QA_ORACLE_AGENT_ID = String(args.agent || config.agentId || "qa-oracle");
  process.env.QA_ORACLE_ACTION_DELAY_MS = String(Math.max(0, Number(config?.execution?.actionDelayMs || 0)));
  process.env.QA_ORACLE_VERBOSE_STEP_LOGS = String(
    String(config?.execution?.verboseStepLogs ?? "true").trim().toLowerCase() !== "false",
  );

  const selectorRegistry = new SelectorRegistry(process.env.QA_ORACLE_SELECTOR_REGISTRY_FILE);
  const agentClient = new OpenClawAgentClient({ agentId: process.env.QA_ORACLE_AGENT_ID });
  const initialRegistry = await selectorRegistry.load();
  let plan = await buildDynamicPlan({
    userStoryText,
    agentClient,
    selectorMappings: initialRegistry.mappings,
    projectContext: config.context,
    storyContext,
    executionConfig: config.execution,
  });
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error(
      "Planner returned no executable steps and no safe fallback was possible. Set context.baseUrl in config and ensure OpenClaw agent planning is available.",
    );
  }
  if (plan.fallbackUsed) {
    console.log(`${TAG} Planner fallback used: built deterministic steps from story context.`);
  }
  const planDraftPath = await writePlanDraft({
    plan,
    storyContext,
    targetDir: toAbsolute(config, config.paths.planDraftDir),
  });
  console.log(`${TAG} Plan draft: ${planDraftPath}`);

  if (manualReview && !autoApprove) {
    const approval = await waitForManualApproval(planDraftPath);
    if (!approval.approved) {
      console.log(`${TAG} Execution aborted by user during manual review.`);
      process.exit(1);
    }
    plan = await readPlanDraft(planDraftPath);
    if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new Error("Reviewed plan has no executable steps.");
    }
    console.log(`${TAG} Plan approved after manual review.`);
  } else if (manualReview && autoApprove) {
    console.log(`${TAG} Manual review enabled but auto-approved via --autoApprove=true.`);
  }

  let testFile = await generatePlaywrightTest({
    plan,
    targetFile: toAbsolute(config, config.paths.generatedTestFile),
  });

  let finalExecution = null;
  const openclawExecutor =
    executionEngine === "openclaw-first"
      ? new OpenClawFirstExecutor({
          agentClient,
          selectorRegistry,
          profile: String(config?.execution?.openclawProfile || "openclaw"),
          clearCookiesOnStart: Boolean(config?.execution?.openclawClearCookiesOnStart),
          bootstrapCookies: Array.isArray(config?.execution?.openclawBootstrapCookies)
            ? config.execution.openclawBootstrapCookies
            : [],
          liveAiActionResolution: Boolean(config?.execution?.openclawLiveAiActionResolution),
          actionDelayMs: Math.max(0, Number(config?.execution?.actionDelayMs || 0)),
          verboseStepLogs: String(process.env.QA_ORACLE_VERBOSE_STEP_LOGS).toLowerCase() === "true",
        })
      : null;
  console.log(
    `${TAG} Phase1 -> steps=${Array.isArray(plan?.steps) ? plan.steps.length : 0}, actionDelayMs=${process.env.QA_ORACLE_ACTION_DELAY_MS}, verboseStepLogs=${process.env.QA_ORACLE_VERBOSE_STEP_LOGS}`,
  );
  let attemptsUsed = 0;
  let usedOpenClawPath = false;
  let usedPlaywrightPath = false;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsUsed = attempt;
      console.log(`${TAG} Attempt ${attempt}/${maxAttempts}: execute generated test`);

      if (openclawExecutor) {
        try {
          const openclawRes = await openclawExecutor.executePlan(plan);
          if (openclawRes.ok) {
            finalExecution = { ok: true, code: 0, llmFailureContext: { ok: true, failureHints: [] } };
            usedOpenClawPath = true;
            console.log(`${TAG} OpenClaw-first execution passed.`);
            break;
          }
          const hint = String(openclawRes.hint || openclawRes.error).slice(0, 400);
          const failedStepIdx = Number.isInteger(Number(openclawRes.failedAt)) ? Number(openclawRes.failedAt) : -1;
          if (failedStepIdx >= 0 && Array.isArray(plan?.steps) && plan.steps[failedStepIdx]) {
            const failedStep = plan.steps[failedStepIdx];
            console.log(
              `${TAG} OpenClaw failed step -> #${failedStepIdx + 1}: "${String(failedStep?.name || "unknown")}" [${String(
                failedStep?.action || "",
              )}] target=${JSON.stringify(failedStep?.target || {})}`,
            );
          }
          if (openclawStrict) {
            console.log(`${TAG} OpenClaw-first failed (strict mode; no Playwright fallback). Hint: ${hint}`);
            finalExecution = {
              ok: false,
              code: 1,
              llmFailureContext: {
                ok: false,
                stderr: hint,
                failureHints: [{ message: hint }],
              },
            };
            break;
          }
          console.log(`${TAG} OpenClaw-first failed, fallback to Playwright. Hint: ${hint}`);
        } catch (error) {
          const reason = String(error?.message || error).slice(0, 400);
          if (openclawStrict) {
            console.log(`${TAG} OpenClaw-first unavailable (strict mode; no Playwright fallback). Reason: ${reason}`);
            finalExecution = {
              ok: false,
              code: 1,
              llmFailureContext: {
                ok: false,
                stderr: reason,
                failureHints: [{ message: reason }],
              },
            };
            break;
          }
          console.log(`${TAG} OpenClaw-first unavailable, fallback to Playwright. Reason: ${reason}`);
        }
      }

      finalExecution = await runExecutionSkill({
        testFile: path.relative(process.cwd(), testFile),
        retries: 0,
        outputRoot: toAbsolute(config, config.paths.executionOutputDir),
      });
      usedPlaywrightPath = true;
      if (finalExecution.ok) break;
      const hints = Array.isArray(finalExecution?.llmFailureContext?.failureHints)
        ? finalExecution.llmFailureContext.failureHints
        : [];
      const firstHint = hints[0]?.message || finalExecution?.llmFailureContext?.stderr || "No failure hint available.";
      console.log(`${TAG} Execution failure hint: ${String(firstHint).slice(0, 400)}`);

      const healPrompt = {
        task: "Update test plan for failed run",
        currentPlan: plan,
        selectorRegistry: (await selectorRegistry.load()).mappings.slice(0, 200),
        failureContext: finalExecution.llmFailureContext,
        constraints: [
          "Return strict JSON only with same schema as plan",
          "Improve locator resilience using accessibility locators",
          "Use role/label/text targets first",
        ],
      };
      const healPlan = await agentClient.ask({
        message: JSON.stringify(healPrompt, null, 2),
        expectJson: true,
      });
      if (!healPlan.ok || !healPlan.json?.steps?.length) {
        console.log(`${TAG} Healer could not produce a revised plan; stopping retries.`);
        break;
      }
      const healedValidation = normalizeAndValidatePlan(healPlan.json, {
        defaultStoryName: String(plan?.storyName || "Generated Story"),
      });
      if (!healedValidation.ok) {
        const topError = healedValidation.errors[0] || "unknown schema error";
        console.log(`${TAG} Healer plan rejected by schema validator: ${topError}`);
        break;
      }
      plan = healedValidation.plan;
      testFile = await generatePlaywrightTest({
        plan,
        targetFile: toAbsolute(config, config.paths.generatedTestFile),
      });
    }
  } finally {
    if (openclawExecutor) await openclawExecutor.close();
  }

  const registry = await selectorRegistry.load();
  const storyName = String(plan.storyName || "Generated Story");
  const heals = registry.mappings.filter((entry) => {
    if (entry.storyName !== storyName) return false;
    const healedAt = Date.parse(entry.healedAt || "");
    return Number.isFinite(healedAt) && healedAt >= startedAt;
  });

  const passed = Boolean(finalExecution?.ok);
  const finalScreenshotPath = path.resolve(
    toAbsolute(config, config.paths.evidenceDir),
    `${storyName.toLowerCase().replace(/[^a-z0-9-_]+/g, "-")}-last-pass.png`,
  );
  const screenshotForReport = (await exists(finalScreenshotPath))
    ? path.relative(process.cwd(), finalScreenshotPath).replace(/\\/g, "/")
    : "N/A";

  const stepResults = plan.steps.map((step) => {
    const heal = heals.find((entry) => entry.stepName === step.name);
    if (heal) {
      return { name: describeAction(step), status: "healed", reason: heal.reason };
    }
    return { name: describeAction(step), status: passed ? "passed" : "failed", reason: "" };
  });

  const reportPath = await writeHumanSummary({
    storyName,
    userStoryText,
    stepsPerformed: stepResults,
    heals,
    finalScreenshotPath: screenshotForReport,
    passed,
    outputDir: toAbsolute(config, config.paths.reportsDir),
  });

  if (configPath) console.log(`${TAG} Using config: ${configPath}`);
  if (storyContext.source === "file" && storyContext.sourcePath) {
    console.log(`${TAG} Story file: ${storyContext.sourcePath}`);
  }
  console.log(`${TAG} Story: ${storyName}`);
  console.log(`${TAG} Status: ${passed ? "PASSED" : "FAILED"}`);
  console.log(`${TAG} Human Summary: ${reportPath}`);
  console.log(
    `${TAG} Phase1 Metrics -> attemptsUsed=${attemptsUsed}, durationMs=${Date.now() - startedAt}, heals=${heals.length}, path=${
      usedOpenClawPath && !usedPlaywrightPath ? "openclaw-only" : usedPlaywrightPath ? "openclaw+playwright" : "unknown"
    }`,
  );
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(`${TAG} Fatal: ${error.message}`);
  process.exit(1);
});
