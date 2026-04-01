import { BasePage } from "./base-page.mjs";

export class StoryPage extends BasePage {
  constructor({ page, selectorRegistry, visionHealer, storyName }) {
    super(page);
    this.selectorRegistry = selectorRegistry;
    this.visionHealer = visionHealer;
    this.storyName = storyName;
  }

  async runStep(step, healEvents) {
    const action = String(step.action || "").toLowerCase();
    const stepName = String(step.name || action || "step");
    if (await this.#shouldSkipByAuthCondition(step)) return;

    if (action === "goto") {
      const targetUrl = this.#resolveEnvPlaceholders(step.target?.value || step.value);
      await this.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      return;
    }

    if (action === "asserturlincludes") {
      const expected = this.#resolveEnvPlaceholders(step.value || "");
      if (!this.page.url().includes(expected)) {
        throw new Error(`URL assertion failed. Expected URL to include "${expected}", got "${this.page.url()}"`);
      }
      return;
    }

    if (action === "assertvisible") {
      const target = this.byTarget(step.target);
      if (!target) throw new Error(`Unsupported assertion target for step "${stepName}"`);
      try {
        const picked = await this.#pickUsableLocator(target, step.target, { timeoutMs: 10000 });
        await picked.waitFor({ state: "visible", timeout: 10000 });
      } catch {
        const recovered = await this.#smartAssertVisibleFallback(step);
        if (!recovered) throw new Error(`Visibility assertion failed for step "${stepName}"`);
      }
      return;
    }

    if (action === "press") {
      await this.page.keyboard.press(this.#resolveEnvPlaceholders(step.value || "Enter"));
      return;
    }

    if (action === "click" || action === "fill") {
      try {
        await this.#interactWithHealing(step, healEvents);
      } catch (error) {
        if (this.#isOptionalStep(step) && this.#isIgnorableOptionalError(error?.message || error)) return;
        throw error;
      }
      return;
    }

    throw new Error(`Unsupported action "${action}" for step "${stepName}"`);
  }

  async #interactWithHealing(step, healEvents) {
    const action = String(step.action || "").toLowerCase();
    const oldSelectorRaw = String(step?.target?.value || "");
    const resolvedSelector = oldSelectorRaw ? await this.selectorRegistry.resolveSelector(oldSelectorRaw) : "";
    const resolvedValue = this.#resolveEnvPlaceholders(step.value || "");
    const candidateTarget =
      resolvedSelector && step.target?.type === "selector"
        ? { ...step.target, value: resolvedSelector }
        : step.target;
    let locator = this.byTarget(candidateTarget);
    if (!locator && resolvedSelector) locator = this.page.locator(resolvedSelector);
    if (!locator) throw new Error(`Unsupported target for ${action}: ${JSON.stringify(step.target)}`);

    try {
      const picked = await this.#pickUsableLocator(locator, step.target, { timeoutMs: 8000 });
      if (action === "click") await picked.click({ timeout: 8000 });
      if (action === "fill") await picked.fill(resolvedValue, { timeout: 8000 });
      return;
    } catch (error) {
      const recovered =
        action === "click"
          ? await this.#smartClickFallback(step)
          : await this.#smartFillFallback(step, resolvedValue);
      if (recovered) {
        healEvents.push({
          stepName: step.name,
          oldSelector: oldSelectorRaw || JSON.stringify(step.target),
          newSelector: recovered.selector,
          confidence: 0.9,
          reason: recovered.reason,
        });
        return;
      }

      const heal = await this.visionHealer.healLocator({
        page: this.page,
        storyName: this.storyName,
        pageName: "StoryPage",
        stepName: step.name,
        oldSelector: oldSelectorRaw || JSON.stringify(step.target),
        errorMessage: error.message,
      });
      if (!heal.healed) throw error;

      const healedTarget = { type: "selector", value: heal.newSelector };
      const healedLocator = this.byTarget(healedTarget) || this.page.locator(heal.newSelector);
      const healedPicked = await this.#pickUsableLocator(healedLocator, step.target, { timeoutMs: 8000 });
      if (action === "click") await healedPicked.click({ timeout: 8000 });
      if (action === "fill") await healedPicked.fill(resolvedValue, { timeout: 8000 });
      healEvents.push({
        stepName: step.name,
        oldSelector: oldSelectorRaw || JSON.stringify(step.target),
        newSelector: heal.newSelector,
        confidence: heal.confidence,
        reason: heal.reason,
      });
    }
  }

  async #smartFillFallback(step, value) {
    const labelHint = String(step?.target?.value || step?.target?.name || "").trim();
    const escaped = this.#escapeRx(labelHint || "input");
    const hintTokens = this.#extractTokens(labelHint);
    const candidates = [
      { selector: `label:${labelHint || "generic"}`, locator: this.page.getByLabel(labelHint || "", { exact: false }) },
      { selector: `placeholder:${labelHint || "generic"}`, locator: this.page.getByPlaceholder(labelHint || "", { exact: false }) },
      {
        selector: `role:textbox:${labelHint || "generic"}`,
        locator: this.page.getByRole("textbox", { name: new RegExp(escaped, "i") }),
      },
      {
        selector: "css:generic-inputs",
        locator: this.page.locator("input,textarea,[contenteditable='true']"),
      },
    ];
    for (const token of hintTokens) {
      const tokenRx = this.#escapeRx(token);
      candidates.push({
        selector: `css:attr-contains:${token}`,
        locator: this.page.locator(
          `input[aria-label*="${token}" i],input[placeholder*="${token}" i],input[name*="${token}" i],input[id*="${token}" i],textarea[aria-label*="${token}" i],textarea[placeholder*="${token}" i],textarea[name*="${token}" i]`,
        ),
      });
      candidates.push({
        selector: `role:textbox:${token}`,
        locator: this.page.getByRole("textbox", { name: new RegExp(tokenRx, "i") }),
      });
    }

    for (const candidate of candidates) {
      try {
        if (!candidate.locator) continue;
        const picked = await this.#pickUsableLocator(candidate.locator, step.target, { timeoutMs: 5000 });
        await picked.waitFor({ state: "visible", timeout: 5000 });
        await picked.fill(value, { timeout: 5000 });
        return { selector: candidate.selector, reason: "smart-fill-fallback" };
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  async #smartClickFallback(step) {
    const nameHint = String(step?.target?.name || step?.target?.value || "").trim();
    const escaped = this.#escapeRx(nameHint || "button");
    const hintTokens = this.#extractTokens(nameHint);
    const isCartHint = /\bcart\b/i.test(nameHint);
    const candidates = [
      {
        selector: `role:button:${nameHint || "generic"}`,
        locator: this.page.getByRole("button", { name: new RegExp(escaped, "i") }),
      },
      {
        selector: `role:link:${nameHint || "generic"}`,
        locator: this.page.getByRole("link", { name: new RegExp(escaped, "i") }),
      },
      {
        selector: `text:${nameHint || "generic"}`,
        locator: this.page.getByText(nameHint || "", { exact: false }),
      },
      {
        selector: "css:common-clickables",
        locator: this.page.locator("button,[role='button'],a,input[type='button'],input[type='submit']"),
      },
    ];
    if (isCartHint) {
      candidates.unshift(
        {
          selector: "css:cart-semantic-visible",
          locator: this.page.locator(
            "a[href*='/gp/cart' i]:visible,a[href*='/cart' i]:visible,a[id*='cart' i]:visible,a[aria-label*='cart' i]:visible",
          ),
        },
        {
          selector: "role:link:cart-visible",
          locator: this.page.getByRole("link", { name: /cart/i }),
        },
      );
    }
    for (const token of hintTokens) {
      const tokenRx = new RegExp(this.#escapeRx(token), "i");
      candidates.push({
        selector: `css:clickable-text:${token}`,
        locator: this.page
          .locator("button,[role='button'],a,input[type='button'],input[type='submit']")
          .filter({ hasText: tokenRx }),
      });
      candidates.push({
        selector: `css:clickable-attrs:${token}`,
        locator: this.page.locator(
          `button[aria-label*="${token}" i],a[aria-label*="${token}" i],button[title*="${token}" i],a[title*="${token}" i],input[value*="${token}" i],input[name*="${token}" i],button[id*="${token}" i],a[id*="${token}" i]`,
        ),
      });
    }

    for (const candidate of candidates) {
      try {
        if (!candidate.locator) continue;
        const picked = await this.#pickUsableLocator(candidate.locator, step.target, { timeoutMs: 5000 });
        await picked.waitFor({ state: "visible", timeout: 5000 });
        await picked.click({ timeout: 5000 });
        return { selector: candidate.selector, reason: "smart-click-fallback" };
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  async #smartAssertVisibleFallback(step) {
    const nameHint = String(step?.target?.name || step?.target?.value || step?.name || "").trim();
    const escaped = this.#escapeRx(nameHint || "payment");
    const hintTokens = this.#extractTokens(nameHint);
    const candidates = [
      { locator: this.page.getByLabel(nameHint || "", { exact: false }) },
      { locator: this.page.getByPlaceholder(nameHint || "", { exact: false }) },
      { locator: this.page.getByText(nameHint || "", { exact: false }) },
      { locator: this.page.getByRole("heading", { name: new RegExp(escaped, "i") }) },
      { locator: this.page.getByRole("textbox", { name: new RegExp(escaped, "i") }) },
      {
        locator: this.page.locator(
          "input[name*='card' i],input[id*='card' i],input[autocomplete*='cc-' i],input[placeholder*='card' i],input[aria-label*='card' i]",
        ),
      },
    ];
    for (const token of hintTokens) {
      const tokenRx = new RegExp(this.#escapeRx(token), "i");
      candidates.push({ locator: this.page.getByRole("heading", { name: tokenRx }) });
      candidates.push({ locator: this.page.getByRole("textbox", { name: tokenRx }) });
      candidates.push({ locator: this.page.getByText(token, { exact: false }) });
    }
    for (const candidate of candidates) {
      try {
        const picked = await this.#pickUsableLocator(candidate.locator, step.target, { timeoutMs: 2500 });
        await picked.waitFor({ state: "visible", timeout: 2500 });
        return true;
      } catch {
        // keep trying
      }
    }
    return false;
  }

  #resolveEnvPlaceholders(raw) {
    const text = String(raw ?? "");
    const trimmed = text.trim();
    if (!trimmed) return "";

    const patterns = [
      /^env:([A-Z0-9_]+)$/i,
      /^\$\{([A-Z0-9_]+)\}$/i,
      /^\$([A-Z0-9_]+)$/i,
      /^\{\{([A-Z0-9_]+)\}\}$/i,
    ];
    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      const key = match[1];
      const value = process.env[key];
      if (!value) {
        throw new Error(`Missing required environment variable "${key}" for step value.`);
      }
      return value;
    }
    return text;
  }

  #isOptionalStep(step) {
    return Boolean(step?.optional);
  }

  #isIgnorableOptionalError(errorText) {
    const text = String(errorText || "").toLowerCase();
    return (
      text.includes("no visible locator match found") ||
      text.includes("timeout") ||
      text.includes("not found") ||
      text.includes("not visible")
    );
  }

  #escapeRx(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  #extractTokens(text) {
    return String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3)
      .slice(0, 6);
  }

  #pickLocatorByIndex(locator, target = {}) {
    const raw = target?.index;
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 0) {
      return locator.nth(index);
    }
    return locator.first();
  }

  async #pickUsableLocator(locator, target = {}, { timeoutMs = 3000 } = {}) {
    const raw = target?.index;
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 0) {
      return locator.nth(index);
    }

    const maxScan = 30;
    let count = 0;
    try {
      count = await locator.count();
    } catch {
      return locator.first();
    }
    const scanCount = Math.min(Math.max(count, 1), maxScan);
    for (let i = 0; i < scanCount; i += 1) {
      const candidate = locator.nth(i);
      try {
        await candidate.waitFor({ state: "visible", timeout: timeoutMs });
        return candidate;
      } catch {
        // try next match
      }
    }
    throw new Error("No visible locator match found");
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
    const state = await this.page.evaluate(() => {
      const text = String(document.body?.innerText || "").toLowerCase();
      const url = String(window.location?.href || "").toLowerCase();
      return { text, url };
    });
    const text = String(state?.text || "");
    const url = String(state?.url || "");

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
}
