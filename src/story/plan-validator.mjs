const ACTION_ALIASES = new Map([
  ["goto", "goto"],
  ["navigate", "goto"],
  ["open", "goto"],
  ["visit", "goto"],
  ["click", "click"],
  ["tap", "click"],
  ["fill", "fill"],
  ["type", "fill"],
  ["input", "fill"],
  ["enter", "fill"],
  ["press", "press"],
  ["assertvisible", "assertVisible"],
  ["assert_visible", "assertVisible"],
  ["asserturlincludes", "assertUrlIncludes"],
  ["assert_url_includes", "assertUrlIncludes"],
]);

function toBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(raw)) return true;
  if (["false", "0", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function normalizeRunWhen(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "authenticated" || mode === "unauthenticated" || mode === "always") return mode;
  return "always";
}

function normalizeTarget(rawTarget, step) {
  if (rawTarget && typeof rawTarget === "object" && !Array.isArray(rawTarget)) {
    const target = { ...rawTarget };
    if (Number.isFinite(Number(target.index)) && Number(target.index) >= 0) {
      target.index = Math.floor(Number(target.index));
    } else {
      delete target.index;
    }
    return target;
  }
  const hint = String(step?.value || step?.name || "").trim();
  return hint ? { type: "text", value: hint } : {};
}

function hasUsableTarget(target) {
  const t = target && typeof target === "object" ? target : {};
  return Boolean(
    String(t.selector || "").trim() ||
      String(t.value || "").trim() ||
      String(t.name || "").trim() ||
      (String(t.type || "").toLowerCase() === "role" && String(t.role || "").trim()),
  );
}

export function normalizeAndValidatePlan(rawPlan, { defaultStoryName = "Generated Story" } = {}) {
  const errors = [];
  const base = rawPlan && typeof rawPlan === "object" ? rawPlan : {};
  const rawSteps = Array.isArray(base.steps) ? base.steps : [];
  const steps = rawSteps.map((rawStep, idx) => {
    const step = rawStep && typeof rawStep === "object" ? rawStep : {};
    const actionRaw = String(step.action || "").trim().toLowerCase();
    const action = ACTION_ALIASES.get(actionRaw) || "";
    const normalized = {
      name: String(step.name || `Step ${idx + 1}`),
      action,
      target: normalizeTarget(step.target, step),
      value: typeof step.value === "undefined" ? "" : String(step.value),
      runWhen: normalizeRunWhen(step.runWhen),
      optional: toBoolean(step.optional, false),
    };
    if (Number.isFinite(Number(step.delayMs)) && Number(step.delayMs) >= 0) {
      normalized.delayMs = Math.floor(Number(step.delayMs));
    }
    if (step.authCheck && typeof step.authCheck === "object") {
      normalized.authCheck = step.authCheck;
    }
    return normalized;
  });

  if (steps.length === 0) {
    errors.push("Plan must include at least one executable step.");
  }

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step.action) {
      errors.push(`Step ${i + 1}: unsupported or missing action.`);
      continue;
    }
    if (step.action === "goto") {
      const url = String(step?.target?.value || step?.value || "").trim();
      if (!/^https?:\/\//i.test(url)) {
        errors.push(`Step ${i + 1}: goto requires absolute http(s) URL.`);
      } else {
        step.target = { ...(step.target || {}), type: "url", value: url };
      }
      continue;
    }
    if (step.action === "press") {
      if (!String(step.value || "").trim()) {
        step.value = "Enter";
      }
      continue;
    }
    if (step.action === "assertUrlIncludes") {
      if (!String(step.value || "").trim()) {
        const maybe = String(step?.target?.value || "").trim();
        if (maybe) step.value = maybe;
      }
      if (!String(step.value || "").trim()) {
        errors.push(`Step ${i + 1}: assertUrlIncludes requires value text.`);
      }
      continue;
    }
    if (!hasUsableTarget(step.target)) {
      errors.push(`Step ${i + 1}: ${step.action} requires target with name/value/selector/role.`);
    }
  }

  const plan = {
    storyName: String(base.storyName || "").trim() || String(defaultStoryName || "Generated Story"),
    gherkin: Array.isArray(base.gherkin) ? base.gherkin : [],
    steps,
    ...(base.fallbackUsed ? { fallbackUsed: true } : {}),
    ...(base.customStepsUsed ? { customStepsUsed: true } : {}),
    ...(base.intentModeUsed ? { intentModeUsed: String(base.intentModeUsed) } : {}),
  };
  return { ok: errors.length === 0, errors, plan };
}
