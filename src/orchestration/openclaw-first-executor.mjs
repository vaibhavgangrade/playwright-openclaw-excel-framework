import { OpenClawClient, readOpenClawConfig } from "../openclaw-client.mjs";

export class OpenClawFirstExecutor {
  constructor({
    agentClient,
    selectorRegistry = null,
    profile = "openclaw",
    clearCookiesOnStart = false,
    bootstrapCookies = [],
    liveAiActionResolution = false,
    actionDelayMs = 0,
    verboseStepLogs = true,
  }) {
    this.agentClient = agentClient;
    this.selectorRegistry = selectorRegistry;
    this.profile = profile;
    this.clearCookiesOnStart = Boolean(clearCookiesOnStart);
    this.bootstrapCookies = Array.isArray(bootstrapCookies) ? bootstrapCookies : [];
    this.liveAiActionResolution = Boolean(liveAiActionResolution);
    this.actionDelayMs = Math.max(0, Number(actionDelayMs || 0));
    this.verboseStepLogs = Boolean(verboseStepLogs);
    this.client = null;
    this.started = false;
    this.cookiesInitialized = false;
  }

  async executePlan(plan) {
    await this.#ensureClient();
    const steps = Array.isArray(plan?.steps) ? plan.steps : [];
    const executed = [];

    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i];
      const stepName = String(step?.name || `step-${i + 1}`);
      const stepAction = String(step?.action || "").toLowerCase();
      const targetPreview = JSON.stringify(step?.target || {}).slice(0, 240);
      const stepStart = Date.now();
      if (this.verboseStepLogs) {
        console.log(
          `[QA-Oracle][OpenClaw][${i + 1}/${steps.length}] START ${stepName} action=${stepAction} target=${targetPreview}`,
        );
      }
      const result = await this.#executeStep(step);
      result.stepIndex = i + 1;
      result.totalSteps = steps.length;
      result.stepName = stepName;
      result.action = stepAction;
      result.target = step?.target || {};
      result.durationMs = Date.now() - stepStart;
      executed.push(result);
      if (this.verboseStepLogs) {
        if (result.ok) {
          console.log(
            `[QA-Oracle][OpenClaw][${i + 1}/${steps.length}] DONE ${stepName} mode=${String(result.mode || "n/a")} durationMs=${result.durationMs}`,
          );
        } else {
          console.log(
            `[QA-Oracle][OpenClaw][${i + 1}/${steps.length}] FAIL ${stepName} error=${String(result.error || result.hint || "unknown").slice(0, 280)}`,
          );
        }
      }
      if (!result.ok) {
        const rootError = String(result.error || result.hint || "openclaw_step_failed");
        return {
          ok: false,
          failedAt: i,
          steps: executed,
          error: rootError,
          hint: `[${i + 1}/${steps.length}] ${stepName}: ${rootError}`,
        };
      }
      const delayMs = this.#resolveStepDelayMs(step);
      if (delayMs > 0 && i < steps.length - 1) {
        await this.#sleep(delayMs);
      }
    }

    return { ok: true, steps: executed };
  }

  async close() {
    if (this.client && this.started) {
      await this.client.browser(["stop"], { timeoutMs: 30000 }).catch(() => {});
    }
  }

  async #ensureClient() {
    if (this.client) return;
    const config = await readOpenClawConfig();
    const token = config?.gateway?.auth?.token || "";
    if (!token) throw new Error("OpenClaw gateway token missing in ~/.openclaw/openclaw.json");

    this.client = new OpenClawClient(process.cwd(), token, this.profile);
    const status = await this.client.browser(["status"], { timeoutMs: 30000 });
    if (!status.ok) throw new Error(`OpenClaw browser unavailable: ${status.stderr || status.stdout}`);
    const started = await this.client.browser(["start"], { timeoutMs: 60000 });
    if (!started.ok) throw new Error(`OpenClaw browser start failed: ${started.stderr || started.stdout}`);
    this.started = true;
    await this.#initializeCookies();
  }

  async #initializeCookies() {
    if (this.cookiesInitialized) return;
    if (this.clearCookiesOnStart) {
      const cleared = await this.client.browser(["cookies", "clear"], { timeoutMs: 20000 });
      if (!cleared.ok) throw new Error(`OpenClaw cookies clear failed: ${cleared.stderr || cleared.stdout}`);
    }
    for (const cookie of this.bootstrapCookies) {
      const name = String(cookie?.name || "").trim();
      const url = String(cookie?.url || "").trim();
      const rawValue = String(cookie?.value || cookie?.valueEnv || "").trim();
      if (!name || !url || !rawValue) continue;
      const value = this.#resolveEnvPlaceholders(rawValue);
      const setRes = await this.client.browser(["cookies", "set", "--url", url, name, value], { timeoutMs: 20000 });
      if (!setRes.ok) throw new Error(`OpenClaw cookie seed failed for "${name}": ${setRes.stderr || setRes.stdout}`);
    }
    this.cookiesInitialized = true;
  }

  async #executeStep(step) {
    if (await this.#shouldSkipByAuthCondition(step)) {
      return { ok: true, skipped: true, mode: "openclaw:skip-by-auth-state", stepName: step?.name || "step" };
    }

    const action = String(step?.action || "").toLowerCase();
    if (action === "goto") {
      const url = this.#resolveEnvPlaceholders(String(step?.target?.value || step?.value || "").trim());
      const nav = await this.client.browser(["navigate", url], { timeoutMs: 45000 });
      return nav.ok
        ? { ok: true, mode: "openclaw:navigate", stepName: step?.name || action }
        : { ok: false, error: nav.stderr || nav.stdout, stepName: step?.name || action };
    }

    if (action === "press") {
      const key = this.#resolveEnvPlaceholders(String(step?.value || "Enter"));
      const pressed = await this.client.browser(["press", key], { timeoutMs: 20000 });
      return pressed.ok
        ? { ok: true, mode: "openclaw:press", stepName: step?.name || action }
        : { ok: false, error: pressed.stderr || pressed.stdout, stepName: step?.name || action };
    }

    if (action === "asserturlincludes") {
      const expected = this.#resolveEnvPlaceholders(String(step?.value || "").trim());
      const fn = `() => window.location.href.includes(${JSON.stringify(expected)})`;
      const evalRes = await this.client.browser(["evaluate", "--fn", fn], { timeoutMs: 20000 });
      const ok = evalRes.ok && (evalRes.json === true || evalRes.json?.result === true || evalRes.json?.value === true);
      return ok
        ? { ok: true, mode: "openclaw:assert-url", stepName: step?.name || action }
        : { ok: false, error: `URL does not include "${expected}"`, stepName: step?.name || action };
    }

    if (action === "assertvisible") {
      const textHint = String(step?.target?.value || step?.target?.name || step?.name || "").trim();
      const waited = await this.client.browser(["wait", "--text", textHint, "--timeout-ms", "12000"], { timeoutMs: 20000 });
      if (waited.ok) {
        return { ok: true, mode: "openclaw:assert-visible", stepName: step?.name || action };
      }
      const fn = `() => {
        const needle = ${JSON.stringify(textHint)}.trim().toLowerCase();
        if (!needle) return false;
        const bodyText = String(document.body?.innerText || "").toLowerCase();
        if (bodyText.includes(needle)) return true;
        const nodes = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,button,a,span,div,p,strong,label,li"));
        return nodes.some((node) => String(node.textContent || "").toLowerCase().includes(needle));
      }`;
      const evalRes = await this.client.browser(["evaluate", "--fn", fn], { timeoutMs: 15000 });
      const evalOk = evalRes.ok && (evalRes.json === true || evalRes.json?.result === true || evalRes.json?.value === true);
      if (evalOk) {
        return { ok: true, mode: "openclaw:assert-visible-evaluate", stepName: step?.name || action };
      }
      const detail =
        String(waited.stderr || waited.stdout || "").trim() ||
        String(evalRes.stderr || evalRes.stdout || "").trim() ||
        `Text "${textHint}" not found in page content`;
      return { ok: false, error: detail, stepName: step?.name || action };
    }

    if (action === "click") {
      const aiResolved = await this.#tryAgentResolvedAction(step, "click", "");
      if (aiResolved?.ok) return aiResolved;
      const byRef = await this.#executeBySnapshotRef(step, "click", "");
      if (byRef?.ok) return byRef;
      const clickRes = await this.#evaluateStepAction(step, "click", "");
      if (!clickRes.ok && this.#isNotClickableError(clickRes.error)) {
        const recovered = await this.#retryAfterUnblock(step, "click", "");
        if (recovered.ok) return recovered;
      }
      const clickResult = clickRes.ok
        ? { ok: true, mode: "openclaw:evaluate-click", stepName: step?.name || action }
        : {
            ok: false,
            error:
              clickRes.error ||
              `OpenClaw click evaluate failed at step "${String(step?.name || action)}" target=${JSON.stringify(step?.target || {})}`,
            stepName: step?.name || action,
          };
      if (!clickResult.ok && this.#isOptionalStep(step) && this.#isIgnorableOptionalError(clickResult.error)) {
        return {
          ok: true,
          skipped: true,
          mode: "openclaw:optional-step-skipped",
          stepName: step?.name || action,
        };
      }
      return clickResult;
    }

    if (action === "fill") {
      const value = this.#resolveEnvPlaceholders(String(step?.value || ""));
      const aiResolved = await this.#tryAgentResolvedAction(step, "fill", value);
      if (aiResolved?.ok) return aiResolved;
      const byRef = await this.#executeBySnapshotRef(step, "fill", value);
      if (byRef?.ok) return byRef;
      const fillRes = await this.#evaluateStepAction(step, "fill", value);
      if (!fillRes.ok && this.#isNotClickableError(fillRes.error)) {
        const recovered = await this.#retryAfterUnblock(step, "fill", value);
        if (recovered.ok) return recovered;
      }
      const fillResult = fillRes.ok
        ? { ok: true, mode: "openclaw:evaluate-fill", stepName: step?.name || action }
        : {
            ok: false,
            error:
              fillRes.error ||
              `OpenClaw fill evaluate failed at step "${String(step?.name || action)}" target=${JSON.stringify(step?.target || {})}`,
            stepName: step?.name || action,
          };
      if (!fillResult.ok && this.#isOptionalStep(step) && this.#isIgnorableOptionalError(fillResult.error)) {
        return {
          ok: true,
          skipped: true,
          mode: "openclaw:optional-step-skipped",
          stepName: step?.name || action,
        };
      }
      return fillResult;
    }

    return { ok: false, error: `Unsupported step action for OpenClaw-first: ${action}`, stepName: step?.name || action };
  }

  async #shouldSkipByAuthCondition(step) {
    const mode = String(step?.runWhen || "always").toLowerCase().trim();
    if (mode !== "authenticated" && mode !== "unauthenticated") return false;
    const isAuthenticated = await this.#detectAuthenticatedState(step?.authCheck || {});
    if (mode === "authenticated" && !isAuthenticated) return true;
    if (mode === "unauthenticated" && isAuthenticated) return true;
    return false;
  }

  async #detectAuthenticatedState(authCheck = {}) {
    const evalRes = await this.client.browser(
      [
        "evaluate",
        "--fn",
        `() => {
          const text = String(document.body?.innerText || "").toLowerCase();
          const url = String(window.location?.href || "").toLowerCase();
          return { text, url };
        }`,
      ],
      { timeoutMs: 20000 },
    );
    const value = evalRes?.json?.result ?? evalRes?.json?.value ?? evalRes?.json ?? {};
    const text = String(value?.text || "").toLowerCase();
    const url = String(value?.url || "").toLowerCase();

    const authAny = Array.isArray(authCheck?.authenticatedAny) ? authCheck.authenticatedAny : [];
    const unauthAny = Array.isArray(authCheck?.unauthenticatedAny) ? authCheck.unauthenticatedAny : [];
    if (authAny.length > 0 || unauthAny.length > 0) {
      const authHitExplicit = authAny.some((token) => {
        const t = String(token || "").toLowerCase().trim();
        return t && (text.includes(t) || url.includes(t));
      });
      const unauthHitExplicit = unauthAny.some((token) => {
        const t = String(token || "").toLowerCase().trim();
        return t && (text.includes(t) || url.includes(t));
      });
      if (authHitExplicit && !unauthHitExplicit) return true;
      if (unauthHitExplicit && !authHitExplicit) return false;
    }

    const authSignals = [/sign out/, /log out/, /\bmy account\b/, /\byour account\b/, /\bprofile\b/, /account & lists/];
    const unauthSignals = [/sign in/, /log in/, /\/ap\/signin/, /\/login/];

    const authHit = authSignals.some((rx) => rx.test(text) || rx.test(url));
    const unauthHit = unauthSignals.some((rx) => rx.test(text) || rx.test(url));
    if (authHit && !unauthHit) return true;
    if (unauthHit && !authHit) return false;
    return false;
  }

  #resolveEnvPlaceholders(raw) {
    const text = String(raw ?? "");
    const trimmed = text.trim();
    if (!trimmed) return "";
    const patterns = [/^env:([A-Z0-9_]+)$/i, /^\$\{([A-Z0-9_]+)\}$/i, /^\$([A-Z0-9_]+)$/i, /^\{\{([A-Z0-9_]+)\}\}$/i];
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      const key = match[1];
      const value = process.env[key];
      if (!value) throw new Error(`Missing required environment variable "${key}" for OpenClaw-first step value.`);
      return value;
    }
    return text;
  }

  #compactSnapshot(snapshotPayload) {
    const raw =
      typeof snapshotPayload === "string"
        ? snapshotPayload
        : JSON.stringify(snapshotPayload || {}, null, 2);
    return String(raw || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4500);
  }

  async #tryAgentResolvedAction(step, action, value) {
    if (!this.liveAiActionResolution || !this.agentClient) return null;
    const snapshotRes = await this.client.browser(
      ["snapshot", "--format", "ai", "--efficient", "--interactive", "--limit", "220"],
      { timeoutMs: 25000 },
    );
    if (!snapshotRes.ok) return null;

    const target = step?.target || {};
    const prompt = {
      task: "Pick best UI element ref for browser action",
      constraints: [
        "Return strict JSON only",
        "Prefer interactive element refs present in snapshot",
        "For fill actions, choose input-like field refs",
      ],
      outputSchema: {
        ref: "string",
        selectorSuggestion: "string (optional)",
        confidence: "number 0..1",
        reason: "string",
      },
      action,
      stepName: String(step?.name || action),
      targetHint: {
        type: String(target?.type || ""),
        role: String(target?.role || ""),
        name: String(target?.name || target?.value || ""),
      },
      snapshot: this.#compactSnapshot(snapshotRes.json ?? snapshotRes.stdout),
    };

    const chosen = await this.agentClient.ask({
      message: JSON.stringify(prompt),
      expectJson: true,
    });
    const ref = String(chosen?.json?.ref || "").trim();
    if (!chosen?.ok || !ref) return null;

    if (action === "click") {
      const clickRes = await this.client.browser(["click", ref], { timeoutMs: 20000 });
      if (!clickRes.ok) return null;
      await this.#recordAiLocatorLearning(step, chosen.json);
      return { ok: true, mode: "openclaw:ai-ref-click", stepName: step?.name || action };
    }

    if (action === "fill") {
      const clickRes = await this.client.browser(["click", ref], { timeoutMs: 20000 });
      if (!clickRes.ok) return null;
      await this.client.browser(["press", "Control+A"], { timeoutMs: 10000 }).catch(() => {});
      await this.client.browser(["press", "Backspace"], { timeoutMs: 10000 }).catch(() => {});
      const typeRes = await this.client.browser(["type", ref, String(value || "")], { timeoutMs: 25000 });
      if (!typeRes.ok) return null;
      await this.#recordAiLocatorLearning(step, chosen.json);
      return { ok: true, mode: "openclaw:ai-ref-fill", stepName: step?.name || action };
    }

    return null;
  }

  async #recordAiLocatorLearning(step, agentJson) {
    if (!this.selectorRegistry?.upsertMapping) return;
    const selectorSuggestion = String(agentJson?.selectorSuggestion || "").trim();
    if (!selectorSuggestion) return;
    const oldSelector = JSON.stringify(step?.target || {});
    await this.selectorRegistry.upsertMapping({
      storyName: "",
      pageName: "OpenClawFirstExecutor",
      stepName: String(step?.name || ""),
      oldSelector,
      newSelector: selectorSuggestion,
      reason: String(agentJson?.reason || "openclaw-ai-ref-resolution"),
      confidence: Number(agentJson?.confidence || 0.8),
    });
  }

  #isNotClickableError(errorText) {
    return String(errorText || "").toLowerCase().includes("not_clickable_target");
  }

  #isOptionalStep(step) {
    return Boolean(step?.optional);
  }

  #isIgnorableOptionalError(errorText) {
    const text = String(errorText || "").toLowerCase();
    return (
      text.includes("not_clickable_target") ||
      text.includes("not_found") ||
      text.includes("target_not_visible") ||
      text.includes("no visible locator match found") ||
      text.includes("unsupported_fill_target")
    );
  }

  async #executeBySnapshotRef(step, action, value) {
    const resolvedRef = await this.#resolveRefFromSnapshot(step, action);
    if (!resolvedRef) return null;
    if (action === "click") {
      const clickRes = await this.client.browser(["click", resolvedRef], { timeoutMs: 20000 });
      if (!clickRes.ok) {
        const brief = this.#extractBrowserError(clickRes) || "snapshot_ref_click_failed";
        return { ok: false, error: brief, stepName: step?.name || action };
      }
      return { ok: true, mode: "openclaw:snapshot-ref-click", stepName: step?.name || action };
    }
    if (action === "fill") {
      await this.client.browser(["click", resolvedRef], { timeoutMs: 15000 }).catch(() => {});
      await this.client.browser(["press", "Control+A"], { timeoutMs: 10000 }).catch(() => {});
      await this.client.browser(["press", "Backspace"], { timeoutMs: 10000 }).catch(() => {});
      const typeRes = await this.client.browser(["type", resolvedRef, String(value || "")], { timeoutMs: 25000 });
      if (!typeRes.ok) {
        const brief = this.#extractBrowserError(typeRes) || "snapshot_ref_fill_failed";
        return { ok: false, error: brief, stepName: step?.name || action };
      }
      return { ok: true, mode: "openclaw:snapshot-ref-fill", stepName: step?.name || action };
    }
    return null;
  }

  async #resolveRefFromSnapshot(step, action) {
    const snap = await this.client.browser(
      ["snapshot", "--format", "ai", "--interactive", "--efficient", "--limit", "260"],
      { timeoutMs: 30000 },
    );
    if (!snap.ok) return "";
    const refs = snap?.json?.refs && typeof snap.json.refs === "object" ? snap.json.refs : {};
    const entries = Object.entries(refs);
    if (entries.length === 0) return "";

    const target = step?.target || {};
    const hint = String(target?.name || target?.value || step?.name || "").trim();
    const needle = hint.toLowerCase();
    const roleHint = String(target?.role || this.#inferRoleFromTarget(step, action)).toLowerCase();
    const desiredIndex = Number.isInteger(Number(target?.index)) && Number(target?.index) >= 0 ? Number(target.index) : 0;

    const tokens = needle
      .split(/[^a-z0-9]+/i)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 4)
      .slice(0, 8);

    const toWords = (text) =>
      String(text || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .map((w) => w.trim())
        .filter(Boolean);

    const scoreRole = (role) => {
      const r = String(role || "").toLowerCase();
      if (!r) return 0;
      if (roleHint && r === roleHint) return 50;
      if (action === "fill" && ["textbox", "searchbox", "combobox", "spinbutton"].includes(r)) return 35;
      if (action === "click" && ["button", "link", "menuitem", "tab"].includes(r)) return 20;
      return 0;
    };

    const ranked = entries
      .map(([ref, meta]) => {
        const name = String(meta?.name || "").toLowerCase();
        const role = String(meta?.role || "").toLowerCase();
        const words = toWords(name);
        let score = scoreRole(role);
        if (needle) {
          if (name === needle) score += 120;
          else if (name.includes(needle)) score += 90;
          else if (needle.includes(name) && name.length > 0) score += 65;
        }
        if (tokens.length > 0) {
          const tokenHits = tokens.filter((t) => words.includes(t)).length;
          score += tokenHits * 10;
        }
        if (action === "click" && /\bdetails\b/.test(name) && !/\bdetails\b/.test(needle)) score -= 25;
        if (action === "click" && /\bcart\b/.test(needle) && /\bcart\b/.test(name)) score += 25;
        if (action === "fill" && /\bsearch\b/.test(needle) && /\bsearch\b/.test(name)) score += 20;
        return { ref, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (needle && ranked.length > 0 && ranked[0].score < 90) return "";
    const picked = ranked[desiredIndex] || ranked[0];
    return String(picked?.ref || "");
  }

  #extractBrowserError(result) {
    const json = result?.json;
    if (json && typeof json === "object") {
      const reason = json?.reason || json?.result?.reason;
      if (reason) return String(reason);
      const err = json?.error || json?.message;
      if (err) return String(err);
    }
    const text = `${result?.stderr || ""}\n${result?.stdout || ""}`.trim();
    return text ? text.slice(0, 260) : "";
  }

  #inferRoleFromTarget(step, action) {
    const target = step?.target || {};
    if (target?.role) return String(target.role);
    const type = String(target?.type || "").toLowerCase();
    if (type === "label" || type === "placeholder") return "textbox";
    if (type === "text" && action === "click") return "link";
    return action === "fill" ? "textbox" : "button";
  }

  async #retryAfterUnblock(step, action, value) {
    await this.client.browser(["press", "Escape"], { timeoutMs: 8000 }).catch(() => {});
    await this.client.browser(["wait", "--time", "900"], { timeoutMs: 5000 }).catch(() => {});
    if (this.liveAiActionResolution) {
      const aiRetry = await this.#tryAgentResolvedAction(step, action, value);
      if (aiRetry?.ok) return aiRetry;
    }
    const byRefRetry = await this.#executeBySnapshotRef(step, action, value);
    if (byRefRetry?.ok) return byRefRetry;
    const evalRetry = await this.#evaluateStepAction(step, action, value);
    if (evalRetry.ok) {
      return { ok: true, mode: `openclaw:recover-${action}-after-unblock`, stepName: step?.name || action };
    }
    return { ok: false, error: evalRetry.error || "retry_after_unblock_failed" };
  }

  async #evaluateStepAction(step, action, value) {
    const target = step?.target || {};
    const payload = {
      action,
      targetType: String(target.type || ""),
      name: String(target.name || target.value || "").trim(),
      value: String(value || ""),
      index: Number.isInteger(Number(target.index)) && Number(target.index) >= 0 ? Number(target.index) : 0,
    };
    const fn = `() => {
      const input = ${JSON.stringify(payload)};
      const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim().toLowerCase();
      const needle = norm(input.name);
      const idx = Number(input.index || 0);
      const clickLikeRole = /^(button|link|tab|menuitem|option|checkbox|radio)$/i;
      const textOf = (el) =>
        norm(
          el?.textContent ||
            el?.innerText ||
            el?.getAttribute?.("aria-label") ||
            el?.getAttribute?.("title") ||
            el?.getAttribute?.("placeholder") ||
            el?.getAttribute?.("name") ||
            el?.id,
        );
      const isEnabled = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hasAttribute("disabled")) return false;
        if (String(el.getAttribute("aria-disabled") || "").toLowerCase() === "true") return false;
        return true;
      };
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (!style || style.display === "none" || style.visibility === "hidden") return false;
        if (style.pointerEvents === "none") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      };
      const isClickable = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const tag = el.tagName.toLowerCase();
        const role = String(el.getAttribute("role") || "");
        if (["button", "a", "summary", "select"].includes(tag)) return true;
        if (tag === "input") {
          const type = String(el.getAttribute("type") || "text").toLowerCase();
          return ["button", "submit", "reset", "checkbox", "radio", "image"].includes(type);
        }
        if (clickLikeRole.test(role)) return true;
        if (typeof el.onclick === "function") return true;
        return false;
      };
      const ensureInView = (el) => {
        if (!(el instanceof HTMLElement)) return;
        const rect = el.getBoundingClientRect();
        const outOfView = rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth;
        if (outOfView) {
          el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        }
      };
      const resolveFillElement = (el) => {
        if (!el) return null;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
        if (el instanceof HTMLElement && el.isContentEditable) return el;
        if (el instanceof HTMLLabelElement) {
          if (el.control) return el.control;
          const forId = el.getAttribute("for");
          if (forId) {
            const linked = document.getElementById(forId);
            if (linked) return linked;
          }
          const nested = el.querySelector("input,textarea,[contenteditable='true']");
          if (nested) return nested;
        }
        if (el instanceof HTMLElement) {
          const nested = el.querySelector("input,textarea,[contenteditable='true']");
          if (nested) return nested;
        }
        return null;
      };
      const resolveClickElement = (el) => {
        if (!el) return null;
        if (isClickable(el)) return el;
        if (!(el instanceof HTMLElement)) return null;
        return el.closest("button,a,[role='button'],[role='link'],input[type='button'],input[type='submit'],summary");
      };

      const candidates = Array.from(
        document.querySelectorAll("button,[role='button'],a,[role='link'],input,textarea,[contenteditable='true'],label,span,div"),
      );
      const ranked = candidates
        .map((el) => {
          const txt = textOf(el);
          let score = 0;
          if (needle) {
            if (txt === needle) score += 100;
            else if (txt.includes(needle)) score += 80;
            else if (needle.includes(txt) && txt.length > 0) score += 60;
          }
          if (isVisible(el)) score += 40;
          if (isEnabled(el)) score += 15;
          if (isClickable(el)) score += 10;
          const tag = el.tagName.toLowerCase();
          if (tag === "div" || tag === "span") score -= 20;
          return { el, score };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score);

      const picked = ranked[idx]?.el || ranked[0]?.el || null;
      if (!picked) return { ok: false, reason: "not_found", needle };
      if (!(picked instanceof HTMLElement)) return { ok: false, reason: "not_html" };

      if (input.action === "click") {
        const clickTarget = resolveClickElement(picked);
        if (!(clickTarget instanceof HTMLElement)) return { ok: false, reason: "not_clickable_target" };
        if (!isVisible(clickTarget)) return { ok: false, reason: "target_not_visible" };
        if (!isEnabled(clickTarget)) return { ok: false, reason: "target_disabled" };
        ensureInView(clickTarget);
        clickTarget.click();
        return { ok: true };
      }

      if (input.action === "fill") {
        const value = String(input.value || "");
        const fillable = resolveFillElement(picked);
        if (!(fillable instanceof HTMLElement)) return { ok: false, reason: "unsupported_fill_target" };
        if (!isVisible(fillable)) return { ok: false, reason: "fill_target_not_visible" };
        if (!isEnabled(fillable)) return { ok: false, reason: "fill_target_disabled" };
        ensureInView(fillable);
        if (fillable instanceof HTMLInputElement || fillable instanceof HTMLTextAreaElement) {
          fillable.focus();
          fillable.value = value;
          fillable.dispatchEvent(new Event("input", { bubbles: true }));
          fillable.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        }
        if (fillable.isContentEditable) {
          fillable.focus();
          fillable.textContent = value;
          fillable.dispatchEvent(new Event("input", { bubbles: true }));
          fillable.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true };
        }
        return { ok: false, reason: "unsupported_fill_target" };
      }

      return { ok: false, reason: "unknown_action" };
    }`;
    const evalRes = await this.client.browser(["evaluate", "--fn", fn], { timeoutMs: 30000 });
    const data = evalRes?.json?.result ?? evalRes?.json?.value ?? evalRes?.json;
    const ok = evalRes.ok && (data === true || data?.ok === true);
    return ok
      ? { ok: true }
      : { ok: false, error: evalRes?.stderr || evalRes?.stdout || JSON.stringify(data || { reason: "evaluate_failed" }) };
  }

  async #sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  #resolveStepDelayMs(step) {
    const raw = Number(step?.delayMs);
    if (Number.isFinite(raw) && raw >= 0) return Math.floor(raw);
    return this.actionDelayMs;
  }
}
