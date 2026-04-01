import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import xlsx from "xlsx";
import { chromium } from "playwright";
import { FallbackPlanner } from "./fallback-planner.mjs";
import { OpenClawClient, readOpenClawConfig } from "./openclaw-client.mjs";
import { clampNumber, loadEnvFiles, parseArgs } from "./utils.mjs";

const TAG = "[Hybrid Runner]";

function normalizeAction(action) {
  const v = String(action || "").trim().toLowerCase();
  if (!v) return "";
  const aliases = {
    open: "navigate",
    goto: "navigate",
    visit: "navigate",
    input: "type",
    enter: "type",
    submit: "press",
    keypress: "press",
    sleep: "wait",
    pause: "wait",
    asserttitle: "asserttitleincludes",
    verifytitle: "asserttitleincludes",
    verifytitleincludes: "asserttitleincludes",
  };
  return aliases[v] || v;
}

function toEnabledFlag(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return true;
  return !["false", "0", "no", "n", "off", "skip"].includes(raw);
}

function normalizeRows(rows) {
  return rows
    .map((row, idx) => ({
      step: Number(row.step || idx + 1),
      action: normalizeAction(row.action),
      targetText: String(row.targetText || row.target || row.stepText || row.text || "").trim(),
      locator: String(row.locator || row.selector || "").trim(),
      value: String(row.value ?? "").trim(),
      fallbackGoal: String(row.fallbackGoal || row.goal || "").trim(),
      timeoutMs: clampNumber(row.timeoutMs, 10000, 1000, 120000),
      enabled: toEnabledFlag(row.enabled),
    }))
    .filter((r) => r.action && r.enabled);
}

function pickHint(step) {
  return String(step.locator || step.targetText || step.fallbackGoal || "").trim();
}

function validateStep(step) {
  const action = String(step.action || "").toLowerCase();
  if (action === "click" || action === "type") {
    const hasLocator = Boolean(String(step.locator || "").trim());
    const hasTarget = Boolean(String(step.targetText || "").trim());
    if (!hasLocator && !hasTarget) {
      throw new Error(
        `${action} step requires at least one of locator or target/targetText. Add a stable locator for reliability.`,
      );
    }
  }
}

async function clickByHint(page, hint, timeout) {
  const textHint = String(hint || "").trim();
  await page.getByText(textHint, { exact: false }).first().click({ timeout });
}

async function typeByHint(page, hint, value, timeout) {
  const textHint = String(hint || "").trim();
  const textValue = String(value ?? "");
  const attempts = [
    () => page.getByLabel(textHint, { exact: false }).first().fill(textValue, { timeout }),
    () => page.getByPlaceholder(textHint, { exact: false }).first().fill(textValue, { timeout }),
    () => page.getByRole("textbox", { name: textHint, exact: false }).first().fill(textValue, { timeout }),
    () => page.getByText(textHint, { exact: false }).first().fill(textValue, { timeout }),
  ];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to type using hint "${textHint}"`);
}

async function runPlaywrightStep(page, step) {
  const action = step.action.toLowerCase();
  const timeout = step.timeoutMs;
  const hint = pickHint(step);

  if (action === "navigate") {
    await page.goto(step.value, { waitUntil: "domcontentloaded", timeout });
    return;
  }
  if (action === "click") {
    if (!hint) throw new Error("Click requires locator or targetText.");
    if (String(step.locator || "").trim()) {
      await page.locator(step.locator).first().click({ timeout });
    } else {
      await clickByHint(page, hint, timeout);
    }
    return;
  }
  if (action === "type") {
    if (!hint) throw new Error("Type requires locator or targetText.");
    if (String(step.locator || "").trim()) {
      await page.locator(step.locator).first().fill(step.value, { timeout });
    } else {
      await typeByHint(page, hint, step.value, timeout);
    }
    return;
  }
  if (action === "press") {
    await page.keyboard.press(step.value || "Enter");
    return;
  }
  if (action === "wait") {
    await page.waitForTimeout(clampNumber(step.value, 1000, 100, 30000));
    return;
  }
  if (action === "asserttitleincludes") {
    const title = (await page.title()).toLowerCase();
    if (!title.includes(step.value.toLowerCase())) {
      throw new Error(`Title assertion failed. Expected includes "${step.value}", got "${title}"`);
    }
    return;
  }
  throw new Error(`Unsupported action in Excel: ${step.action}`);
}

async function runOpenClawFallback(step, openclaw, planner) {
  const action = String(step.action || "").toLowerCase();
  const locator = String(step.locator || "").trim();
  const targetText = String(step.targetText || "").trim();
  const fallbackGoal = String(step.fallbackGoal || "").trim();
  const semanticHint = targetText || fallbackGoal || locator;
  const hint = pickHint(step);

  if (action === "navigate" && step.value) {
    const navRes = await openclaw.browser(["navigate", String(step.value)]);
    if (navRes.ok) return "openclaw-navigate";
  }
  if (action === "press") {
    const key = String(step.value || "Enter");
    const pressRes = await openclaw.browser(["press", key]);
    if (pressRes.ok) return `openclaw-press:${key}`;
  }
  if (action === "wait") {
    const ms = String(clampNumber(step.value, 1000, 100, 30000));
    const waitRes = await openclaw.browser(["wait", "--time", ms, "--timeout-ms", ms]);
    if (waitRes.ok) return `openclaw-wait:${ms}`;
  }
  if (action === "click" && hint) {
    const clickFn = `() => {
      const selector = ${JSON.stringify(locator || hint)};
      const needle = ${JSON.stringify(semanticHint)}.trim().toLowerCase();
      const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim().toLowerCase();
      let el = null;
      try { el = document.querySelector(selector); } catch {}
      if (!el && needle) {
        const candidates = Array.from(
          document.querySelectorAll("button,a,[role='button'],input[type='button'],input[type='submit'],[aria-label],[title],label,span,div")
        );
        el = candidates.find((node) => {
          const t = norm(node.innerText || node.textContent || node.getAttribute("aria-label") || node.getAttribute("title"));
          return t && (t === needle || t.includes(needle));
        }) || null;
      }
      if (!el) return { ok: false, reason: "not_found" };
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center", inline: "center" });
        el.click();
        return { ok: true };
      }
      return { ok: false, reason: "not_html" };
    }`;
    const clickRes = await openclaw.browser(["evaluate", "--fn", clickFn]);
    const clickJson = clickRes.json?.result ?? clickRes.json?.value ?? clickRes.json;
    if (clickRes.ok && (clickJson === true || clickJson?.ok === true)) {
      return "openclaw-eval-click";
    }
  }
  if (action === "type" && hint) {
    const typeFn = `() => {
      const selectorText = ${JSON.stringify(locator || "")};
      const locatorText = ${JSON.stringify(semanticHint)};
      const value = ${JSON.stringify(String(step.value ?? ""))};
      const needle = locatorText.trim().toLowerCase();
      const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim().toLowerCase();
      let input = null;
      try {
        const byCss = selectorText ? document.querySelector(selectorText) : null;
        if (byCss) input = byCss;
      } catch {}
      if (!input && needle) {
        const labels = Array.from(document.querySelectorAll("label"));
        const label = labels.find((l) => {
          const txt = norm(l.innerText || l.textContent);
          return txt && (txt === needle || txt.includes(needle));
        });
        if (label) {
          const htmlFor = label.getAttribute("for");
          if (htmlFor) input = document.getElementById(htmlFor);
          if (!input && label.control) input = label.control;
          if (!input) input = label.querySelector("input,textarea,[contenteditable='true']");
        }
      }
      if (!input && needle) {
        const fields = Array.from(document.querySelectorAll("input,textarea,[contenteditable='true']"));
        input = fields.find((f) => {
          const txt = norm(
            f.getAttribute("aria-label") ||
              f.getAttribute("placeholder") ||
              f.getAttribute("name") ||
              f.id ||
              f.className
          );
          return txt && (txt === needle || txt.includes(needle));
        }) || null;
      }
      if (!input) return { ok: false, reason: "not_found" };
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      if (input instanceof HTMLElement && input.isContentEditable) {
        input.focus();
        input.textContent = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }
      return { ok: false, reason: "unsupported_target" };
    }`;
    const typeRes = await openclaw.browser(["evaluate", "--fn", typeFn]);
    const typeJson = typeRes.json?.result ?? typeRes.json?.value ?? typeRes.json;
    if (typeRes.ok && (typeJson === true || typeJson?.ok === true)) {
      return "openclaw-eval-type";
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Planner unavailable: OPENAI_API_KEY is missing.");
  }

  const snapshotRes = await openclaw.browser(
    ["snapshot", "--interactive", "--compact", "--depth", "6", "--limit", "450"],
    { json: false, timeoutMs: 60000 },
  );
  if (!snapshotRes.ok) {
    throw new Error(`OpenClaw snapshot failed: ${snapshotRes.stderr || snapshotRes.stdout}`);
  }

  const plan = await planner.suggestAction({
    step: {
      action: step.action,
      locator: step.locator,
      value: step.value,
      fallbackGoal: step.fallbackGoal,
    },
    snapshot: snapshotRes.stdout,
  });

  const kind = String(plan.action || "").toLowerCase();
  if (kind === "click" && plan.ref) {
    const res = await openclaw.browser(["click", String(plan.ref)]);
    if (!res.ok) throw new Error(`Fallback click failed: ${res.stderr || res.stdout}`);
    return `openclaw-click:${plan.ref}`;
  }
  if (kind === "type" && plan.ref) {
    const text = String(plan.text ?? step.value ?? "");
    const res = await openclaw.browser(["type", String(plan.ref), text]);
    if (!res.ok) throw new Error(`Fallback type failed: ${res.stderr || res.stdout}`);
    return `openclaw-type:${plan.ref}`;
  }
  if (kind === "press" && plan.key) {
    const res = await openclaw.browser(["press", String(plan.key)]);
    if (!res.ok) throw new Error(`Fallback press failed: ${res.stderr || res.stdout}`);
    return `openclaw-press:${plan.key}`;
  }
  if (kind === "assertion" && plan.assertion) {
    const fn = `() => Boolean(${String(plan.assertion)})`;
    const res = await openclaw.browser(["evaluate", "--fn", fn]);
    if (!res.ok) throw new Error(`Fallback assertion evaluate failed: ${res.stderr || res.stdout}`);
    const ok = res.json === true || res.json?.value === true || res.json?.result === true;
    if (!ok) throw new Error(`Fallback assertion false: ${plan.assertion}`);
    return "openclaw-assertion:passed";
  }

  const plannerReason = plan.reason ? ` (${plan.reason})` : "";
  throw new Error(`Planner returned unsupported fallback action: ${JSON.stringify(plan)}${plannerReason}`);
}

async function main() {
  await loadEnvFiles();
  const args = parseArgs(process.argv);
  const excelPath = path.resolve(process.cwd(), String(args.excel || ""));
  const profile = String(args.profile || "openclaw");
  const executionEngine = String(args.engine || process.env.EXECUTION_ENGINE || "hybrid").toLowerCase();
  const requestedSheet = String(args.sheet || process.env.EXCEL_SHEET || "Steps").trim();
  let browser = null;
  let openclaw = null;
  let openClawStarted = false;

  if (!args.excel) {
    console.error(
      `${TAG} Usage: node src/excel-runner.mjs --excel ./samples/test-steps.xlsx --sheet Steps [--engine hybrid|openclaw]`,
    );
    process.exit(1);
  }

  const config = await readOpenClawConfig();
  const gatewayToken = config?.gateway?.auth?.token || "";
  if (!gatewayToken) {
    throw new Error("OpenClaw gateway token missing in ~/.openclaw/openclaw.json");
  }

  try {
    openclaw = new OpenClawClient(process.cwd(), gatewayToken, profile);
    const status = await openclaw.browser(["status"], { timeoutMs: 30000 });
    if (!status.ok) {
      throw new Error(`OpenClaw browser unavailable: ${status.stderr || status.stdout}`);
    }
    await openclaw.browser(["start"], { timeoutMs: 60000 });
    openClawStarted = true;
    const statusAfterStart = await openclaw.browser(["status"], { timeoutMs: 30000 });
    const cdpUrl = statusAfterStart?.json?.cdpUrl || "http://127.0.0.1:18800";

    const workbook = xlsx.readFile(excelPath);
    const requestedSheetLower = requestedSheet.toLowerCase();
    const preferredSheet = workbook.SheetNames.find((name) => String(name).toLowerCase() === requestedSheetLower);
    if (!preferredSheet) {
      throw new Error(
        `Requested Excel sheet "${requestedSheet}" not found. Available sheets: ${workbook.SheetNames.join(", ")}`,
      );
    }
    console.log(`${TAG} Using Excel sheet: ${preferredSheet}`);
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[preferredSheet], { defval: "" });
    const steps = normalizeRows(rows).sort((a, b) => a.step - b.step);

    const planner = new FallbackPlanner({
      model: process.env.OPENAI_MODEL || "openai/gpt-4.1-mini",
      baseUrl: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENAI_API_KEY || "",
      maxTokens: clampNumber(process.env.PLANNER_MAX_TOKENS, 800, 128, 3000),
    });

    browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = context.pages()[0] || (await context.newPage());

    const resultRows = [];
    let passed = 0;
    let failed = 0;

    for (const step of steps) {
      const stepLabel = `Step ${step.step} (${step.action})`;
      validateStep(step);
      const openClawFirst = executionEngine === "openclaw";
      if (openClawFirst) {
        try {
          const mode = await runOpenClawFallback(step, openclaw, planner);
          console.log(`${TAG} ${stepLabel} -> fallback ok (${mode})`);
          resultRows.push({ ...step, status: "passed", mode, error: "" });
          passed += 1;
          continue;
        } catch (openClawError) {
          try {
            await runPlaywrightStep(page, step);
            console.log(`${TAG} ${stepLabel} -> playwright recovery ok`);
            resultRows.push({ ...step, status: "passed", mode: "playwright-recovery", error: "" });
            passed += 1;
            continue;
          } catch (playwrightRecoveryError) {
            const message = `${openClawError.message} | playwright: ${playwrightRecoveryError.message}`;
            console.log(`${TAG} ${stepLabel} -> failed (${message})`);
            resultRows.push({ ...step, status: "failed", mode: "openclaw+playwright", error: message });
            failed += 1;
            continue;
          }
        }
      }
      try {
        await runPlaywrightStep(page, step);
        console.log(`${TAG} ${stepLabel} -> playwright ok`);
        resultRows.push({ ...step, status: "passed", mode: "playwright", error: "" });
        passed += 1;
      } catch (error) {
        try {
          const mode = await runOpenClawFallback(step, openclaw, planner);
          console.log(`${TAG} ${stepLabel} -> fallback ok (${mode})`);
          resultRows.push({ ...step, status: "passed", mode, error: "" });
          passed += 1;
        } catch (fallbackError) {
          const message = `${error.message} | fallback: ${fallbackError.message}`;
          console.log(`${TAG} ${stepLabel} -> failed (${message})`);
          resultRows.push({ ...step, status: "failed", mode: "playwright+openclaw", error: message });
          failed += 1;
        }
      }
    }

    await mkdir(path.resolve(process.cwd(), "reports"), { recursive: true });
    const reportPath = path.resolve(
      process.cwd(),
      "reports",
      `hybrid-run-${Date.now().toString(36)}.json`,
    );
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          startedAt: new Date().toISOString(),
          excelPath,
          cdpUrl,
          profile,
          summary: { passed, failed, total: steps.length },
          steps: resultRows,
        },
        null,
        2,
      ),
      "utf8",
    );

    console.log(`${TAG} Done. Passed=${passed}, Failed=${failed}`);
    console.log(`${TAG} Report: ${reportPath}`);
    return failed === 0 ? 0 : 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (openclaw && openClawStarted) {
      await openclaw.browser(["stop"], { timeoutMs: 30000 }).catch(() => {});
    }
  }
}

main()
  .then((exitCode) => {
    process.exit(exitCode);
  })
  .catch((error) => {
    console.error(`${TAG} Fatal: ${error.message}`);
    process.exit(1);
  });
