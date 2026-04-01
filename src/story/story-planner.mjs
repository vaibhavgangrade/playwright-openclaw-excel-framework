import { normalizeAndValidatePlan } from "./plan-validator.mjs";

function normalizeStoryName({ userStoryText, storyContext }) {
  const title = String(storyContext?.title || "").trim();
  if (title) return title.slice(0, 80);
  const firstLine = String(userStoryText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine || "Generated Story").slice(0, 80);
}

function inferOrdinalIndex(narrative, keywordRegex) {
  const segmentRegex = new RegExp(`(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\\d+(?:st|nd|rd|th)?)\\s+${keywordRegex.source}`, "i");
  const match = String(narrative || "").match(segmentRegex);
  if (!match) return null;
  const token = String(match[1] || "").toLowerCase();
  const words = {
    first: 0,
    second: 1,
    third: 2,
    fourth: 3,
    fifth: 4,
    sixth: 5,
    seventh: 6,
    eighth: 7,
    ninth: 8,
    tenth: 9,
  };
  if (token in words) return words[token];
  const numeric = Number(token.replace(/(st|nd|rd|th)$/i, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.floor(numeric) - 1;
}

function extractUrlFromLine(line) {
  const match = String(line || "").match(/https?:\/\/[^\s)]+/i);
  return match ? String(match[0]).trim() : "";
}

function extractExplicitNavigateUrl(lines = []) {
  for (const rawLine of Array.isArray(lines) ? lines : []) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    if (!/\b(navigate|go to|open|visit)\b/i.test(line)) continue;
    const url = extractUrlFromLine(line);
    if (url) return url;
  }
  return "";
}

function resolveTemplateTokens(text, tokens = {}) {
  return String(text || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = tokens?.[key];
    if (typeof value === "undefined" || value === null) return `{{${key}}}`;
    return String(value);
  });
}

function resolveLinesWithTokens(lines = [], tokens = {}) {
  return (Array.isArray(lines) ? lines : []).map((line) => resolveTemplateTokens(line, tokens));
}

function resolveConfiguredIndex(tokens = {}, keyCandidates = []) {
  for (const key of keyCandidates) {
    const raw = String(tokens?.[key] ?? "").trim();
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n) - 1;
  }
  return null;
}

function inferSearchboxName({ projectContext = {}, testDataMap = {}, explicitStoryUrl = "", baseUrl = "" }) {
  const fromData =
    String(testDataMap?.searchBoxName || testDataMap?.search_box_name || testDataMap?.searchbox || "").trim();
  if (fromData) return fromData;
  const fromContext =
    String(projectContext?.searchBoxName || projectContext?.search_box_name || projectContext?.searchbox || "").trim();
  if (fromContext) return fromContext;

  const seedUrl = String(explicitStoryUrl || baseUrl || "").toLowerCase();
  if (seedUrl.includes("walmart.")) return "Search Walmart";
  if (seedUrl.includes("amazon.")) return "Search Amazon";
  return "Search";
}

function toOrdinal(n) {
  const value = Math.max(1, Math.floor(Number(n) || 1));
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  const mod10 = value % 10;
  if (mod10 === 1) return `${value}st`;
  if (mod10 === 2) return `${value}nd`;
  if (mod10 === 3) return `${value}rd`;
  return `${value}th`;
}

function inferStepsFromStoryContext({ projectContext = {}, storyContext = {}, userStoryText = "" }) {
  const baseUrl = String(projectContext?.baseUrl || "").trim();
  const testDataMap = storyContext?.testDataMap && typeof storyContext.testDataMap === "object" ? storyContext.testDataMap : {};
  const rawNarrativeLines = [
    String(storyContext?.userStory || ""),
    String(storyContext?.acceptanceCriteria || ""),
    String(storyContext?.testData || ""),
    String(storyContext?.notes || ""),
    String(userStoryText || ""),
  ]
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const resolvedNarrativeLines = resolveLinesWithTokens(rawNarrativeLines, testDataMap);
  const explicitStoryUrl = extractExplicitNavigateUrl(resolvedNarrativeLines);
  const searchboxName = inferSearchboxName({ projectContext, testDataMap, explicitStoryUrl, baseUrl });
  const userStoryTextOnly = String(storyContext?.userStory || "").toLowerCase();
  const acceptanceOnly = String(storyContext?.acceptanceCriteria || "").toLowerCase();
  const notesOnly = String(storyContext?.notes || "").toLowerCase();
  const narrative = [
    userStoryTextOnly,
    acceptanceOnly,
    String(storyContext?.testData || "").toLowerCase(),
    notesOnly,
    String(userStoryText || ""),
  ]
    .join("\n")
    .toLowerCase();
  const prioritizedNarrative = [acceptanceOnly, notesOnly, userStoryTextOnly].filter(Boolean).join("\n");

  const steps = [];
  if (explicitStoryUrl || baseUrl) {
    steps.push({
      name: explicitStoryUrl ? `Navigate to ${explicitStoryUrl}` : "Navigate to configured base URL",
      action: "goto",
      target: { type: "url", value: explicitStoryUrl || baseUrl },
    });
  }

  const textInputIntent = /\btext input\b|\bsubmit me\b|\binput box\b|\bverify text\b/.test(prioritizedNarrative);
  const buttonIntent = /\bbutton text\b|\bpress the click button\b|\bclick button\b|\bbuttons?\b/.test(prioritizedNarrative);
  const checkboxIntent = /\bcheckbox\b/.test(prioritizedNarrative);
  const selectIntent = /\bselect\b/.test(prioritizedNarrative);
  const newTabIntent = /\bnew tab\b/.test(prioritizedNarrative);
  const textAreaIntent = /\btext area\b|\btextarea\b/.test(prioritizedNarrative);
  const alertsIntent = /\balerts?\b/.test(prioritizedNarrative);
  const dragDropIntent = /\bdrag and drop\b|\bdrag\b.*\bdrop\b/.test(prioritizedNarrative);
  const iframesIntent = /\biframes?\b/.test(prioritizedNarrative);
  const popupIntent = /\bpop-?up\b/.test(prioritizedNarrative);
  const selectCheckboxIntent = /\bselect\b.*\bcheckbox\b|\bcheck\b.*\bcheckbox\b/.test(prioritizedNarrative);
  const selectCheckboxMatch = prioritizedNarrative.match(
    /select\s+the\s+([a-z0-9][a-z0-9\s-]{1,60}?)\s+checkbox/i,
  );
  const checkboxLabel = String(selectCheckboxMatch?.[1] || "").trim();
  const practiceWidgetsIntent =
    textInputIntent ||
    buttonIntent ||
    checkboxIntent ||
    selectIntent ||
    newTabIntent ||
    textAreaIntent ||
    alertsIntent ||
    dragDropIntent ||
    iframesIntent ||
    popupIntent;
  const hasLogin = /\blogin\b|\blog in\b|\bsign in\b/.test(practiceWidgetsIntent ? acceptanceOnly : narrative);
  const conditionalLogin =
    /if\s+.*already\s+authenticated.*skip\s+login|if\s+.*not\s+authenticated.*login|skip\s+login/.test(
      practiceWidgetsIntent ? acceptanceOnly : narrative,
    );
  const hasCart = /\bcart\b/.test(practiceWidgetsIntent ? acceptanceOnly : narrative);
  const hasAddToCart = /\badd to cart\b|\badd\s+\d+\s+item\s+to\s+cart\b|\badd\s+item\s+to\s+cart\b/.test(
    practiceWidgetsIntent ? acceptanceOnly : narrative,
  );
  const hasCheckout = /\bcheckout\b|\bcheck out\b|\bproceed\b/.test(practiceWidgetsIntent ? acceptanceOnly : narrative);
  const hasCreditCard = /\bcredit card\b|\bcard form\b|\bpayment\b/.test(practiceWidgetsIntent ? acceptanceOnly : narrative);
  const addToCartIndex =
    inferOrdinalIndex(narrative, /add to cart(?:\s+button)?/i) ??
    inferOrdinalIndex(narrative, /item to cart/i) ??
    inferOrdinalIndex(narrative, /add button/i);
  const hasDismissPopup = /\bdismiss\b|\bclose\b.*\bpopup\b|\bbanner\b|\blocation popup\b/.test(prioritizedNarrative);
  const hasSearch = /\bsearch\b/.test(prioritizedNarrative);
  const searchQueryMatch = prioritizedNarrative.match(/search\s+for\s+(?:the\s+)?(?:product\s+)?([a-z0-9][a-z0-9\s-]{1,40})/i);
  const searchQuery = String(searchQueryMatch?.[1] || testDataMap?.product_name || testDataMap?.productName || projectContext?.productName || "").trim();
  const productClickMatch = prioritizedNarrative.match(
    /click\s+on\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|\d+(?:st|nd|rd|th)?)\s+([a-z0-9][a-z0-9\s-]{1,40})/i,
  );
  const clickTextInput = /\bclick\b.*\btext input\b/.test(prioritizedNarrative);
  const submitMeMatch = prioritizedNarrative.match(
    /insert\s+text\s+([a-z0-9][a-z0-9\s-]{0,40})\s+into\s+(?:the\s+)?submit me(?:\s+input\s+box)?/i,
  );
  const submitMeValue = String(submitMeMatch?.[1] || "").trim();
  const verifyTextMatch = prioritizedNarrative.match(/verify\s+text\s+([a-z0-9][a-z0-9\s-]{0,40}?)(?:\s+on\s+page|\s*$)/i);
  const verifyTextValue = String(verifyTextMatch?.[1] || submitMeValue || "")
    .replace(/\s+on\s+page$/i, "")
    .trim();

  if (practiceWidgetsIntent) {
    steps.push({
      name: "Expand Single UI Elements menu if collapsed",
      action: "click",
      target: { type: "text", value: "Single UI Elements" },
      optional: true,
    });

    const navCandidates = [
      { key: "inputs", label: "Inputs", rx: /\binputs?\b/ },
      { key: "buttons", label: "Buttons", rx: /\bbuttons\b/ },
      { key: "checkbox", label: "Checkbox", rx: /\bcheckbox\b/ },
      { key: "select", label: "Select", rx: /\bselect\b/ },
      { key: "new-tab", label: "New tab", rx: /\bnew tab\b/ },
      { key: "text-area", label: "Text area", rx: /\btext area\b|\btextarea\b/ },
      { key: "alerts", label: "Alerts", rx: /\balerts?\b/ },
      { key: "drag-drop", label: "Drag and Drop", rx: /\bdrag and drop\b|\bdrag\b.*\bdrop\b/ },
      { key: "iframes", label: "Iframes", rx: /\biframes?\b/ },
      { key: "popup", label: "Pop-Up", rx: /\bpop-?up\b/ },
    ];
    const matchedNav = navCandidates
      .map((candidate) => {
        const idx = prioritizedNarrative.search(candidate.rx);
        return idx >= 0 ? { ...candidate, idx } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.idx - b.idx);
    const addedNavKeys = new Set();
    for (const nav of matchedNav) {
      if (addedNavKeys.has(nav.key)) continue;
      addedNavKeys.add(nav.key);
      steps.push({
        name: `Open ${nav.label} page`,
        action: "click",
        target: { type: "role", role: "link", name: nav.label },
      });
    }

    if (clickTextInput) {
      steps.push({
        name: "Open Text Input page",
        action: "click",
        target: { type: "role", role: "link", name: "Text Input" },
      });
    }
    if (submitMeValue) {
      steps.push(
        {
          name: `Enter ${submitMeValue} into Submit me`,
          action: "fill",
          target: { type: "placeholder", value: "Submit me" },
          value: submitMeValue,
        },
        {
          name: "Submit text input",
          action: "press",
          value: "Enter",
        },
      );
    }
    if (verifyTextValue) {
      steps.push({
        name: `Verify text ${verifyTextValue} on page`,
        action: "assertVisible",
        target: { type: "text", value: verifyTextValue },
      });
    }
    if (/\bclick\b.*\bbutton text\b/.test(prioritizedNarrative) || buttonIntent) {
      steps.push({
        name: "Open Button page",
        action: "click",
        target: { type: "role", role: "link", name: "Button" },
      });
    }
    if (/\bpress the click button\b|\bclick button\b/.test(prioritizedNarrative)) {
      steps.push({
        name: "Press Click button",
        action: "click",
        target: { type: "role", role: "button", name: "Click" },
      });
    }
    if (checkboxIntent) {
      steps.push({
        name: "Open Checkbox page",
        action: "click",
        target: { type: "role", role: "link", name: "Checkbox" },
      });
    }
    if (selectCheckboxIntent) {
      steps.push({
        name: "Select checkbox option",
        action: "click",
        target: { type: "role", role: "checkbox", name: checkboxLabel || "" },
      });
    }
    if (selectIntent) {
      steps.push({
        name: "Open Select page",
        action: "click",
        target: { type: "role", role: "link", name: "Select" },
      });
    }
    if (newTabIntent) {
      steps.push({
        name: "Open New tab page",
        action: "click",
        target: { type: "role", role: "link", name: "New tab" },
        delayMs: 1200,
      });
    }
    if (textAreaIntent) {
      steps.push({
        name: "Open Text area page",
        action: "click",
        target: { type: "role", role: "link", name: "Text area" },
      });
    }
    if (alertsIntent) {
      steps.push({
        name: "Open Alerts page",
        action: "click",
        target: { type: "role", role: "link", name: "Alerts" },
        delayMs: 1000,
      });
    }
    if (dragDropIntent) {
      steps.push({
        name: "Open Drag and Drop page",
        action: "click",
        target: { type: "role", role: "link", name: "Drag and Drop" },
        delayMs: 1200,
      });
    }
    if (iframesIntent) {
      steps.push({
        name: "Open Iframes page",
        action: "click",
        target: { type: "role", role: "link", name: "Iframes" },
        delayMs: 1200,
      });
    }
    if (popupIntent) {
      steps.push({
        name: "Open Pop-Up page",
        action: "click",
        target: { type: "role", role: "link", name: "Pop-Up" },
        delayMs: 1200,
      });
    }

    // Remove exact duplicate step signatures while preserving order.
    const seen = new Set();
    const deduped = [];
    for (const step of steps) {
      const sig = JSON.stringify({
        name: step?.name,
        action: step?.action,
        target: step?.target,
        value: step?.value,
      });
      if (seen.has(sig)) continue;
      seen.add(sig);
      deduped.push(step);
    }
    return deduped;
  }

  const productClickIndex = productClickMatch ? inferOrdinalIndex(productClickMatch[0], new RegExp(productClickMatch[2], "i")) : null;
  const productClickName = String(productClickMatch?.[2] || searchQuery || "").trim();

  if (hasLogin) {
    const loginCondition = conditionalLogin ? { runWhen: "unauthenticated" } : {};
    const authCheck = storyContext?.authRules ? { authCheck: storyContext.authRules } : {};
    steps.push(
      {
        name: "Open sign-in entry point",
        action: "click",
        target: { type: "role", role: "link", name: "Sign in" },
        ...loginCondition,
        ...authCheck,
      },
      {
        name: "Enter username from environment",
        action: "fill",
        target: { type: "label", value: "Email" },
        value: "env:QA_USER",
        ...loginCondition,
        ...authCheck,
      },
      {
        name: "Continue after username",
        action: "click",
        target: { type: "role", role: "button", name: "Continue" },
        ...loginCondition,
        ...authCheck,
      },
      {
        name: "Enter password from environment",
        action: "fill",
        target: { type: "label", value: "Password" },
        value: "env:QA_PASSWORD",
        ...loginCondition,
        ...authCheck,
      },
      {
        name: "Submit login",
        action: "click",
        target: { type: "role", role: "button", name: "Sign in" },
        ...loginCondition,
        ...authCheck,
      },
    );
  }

  if (hasDismissPopup) {
    steps.push({
      name: "Dismiss location/promo popups if visible",
      action: "click",
      target: { type: "role", role: "button", name: "Dismiss" },
      optional: true,
    });
  }

  if (hasSearch && searchQuery) {
    steps.push(
      {
        name: `Search for ${searchQuery}`,
        action: "fill",
        target: { type: "role", role: "searchbox", name: searchboxName },
        value: searchQuery,
      },
      {
        name: "Submit search",
        action: "press",
        value: "Enter",
      },
    );
  }

  if (productClickName) {
    steps.push({
      name: `Open ${productClickIndex !== null ? `${productClickIndex + 1}th` : "a"} ${productClickName} result`,
      action: "click",
      target: {
        type: "role",
        role: "link",
        name: productClickName,
        ...(productClickIndex !== null ? { index: productClickIndex } : {}),
      },
    });
  }

  if (hasCart) {
    steps.push({
      name: "Open cart",
      action: "click",
      target: { type: "role", role: "link", name: "Cart" },
    });
  }

  if (hasAddToCart) {
    steps.push({
      name: "Add item to cart",
      action: "click",
      target: {
        type: "role",
        role: "button",
        name: "Add to cart",
        ...(addToCartIndex !== null ? { index: addToCartIndex } : {}),
      },
    });
  }

  if (hasCheckout) {
    steps.push({
      name: "Proceed to checkout",
      action: "click",
      target: { type: "role", role: "button", name: "Proceed to checkout" },
    });
  }

  if (hasCreditCard) {
    steps.push({
      name: "Verify credit card form is visible",
      action: "assertVisible",
      target: { type: "text", value: "Credit card" },
    });
  }

  return steps;
}

function fallbackPlan(userStoryText, projectContext = {}, storyContext = {}) {
  const text = String(userStoryText || "").trim();
  const baseUrl = String(projectContext?.baseUrl || "").trim();
  const inferred = inferStepsFromStoryContext({ projectContext, storyContext, userStoryText });
  const steps = inferred.length > 0 ? inferred : [];
  if (steps.length === 0 && baseUrl) {
    steps.push({
      name: "Navigate to configured base URL",
      action: "goto",
      target: { type: "url", value: baseUrl },
    });
  }
  return {
    storyName: normalizeStoryName({ userStoryText: text, storyContext }),
    gherkin: [
      { type: "Given", text: "the user is on the target application page" },
      { type: "When", text: "the user performs key actions from the story" },
      { type: "Then", text: "the expected outcome should be visible" },
    ],
    steps,
    fallbackUsed: true,
  };
}

function parseAcceptanceIntentSteps({ projectContext = {}, storyContext = {}, userStoryText = "" }) {
  const baseUrl = String(projectContext?.baseUrl || "").trim();
  const acceptance = String(storyContext?.acceptanceCriteria || "");
  const testDataMap = storyContext?.testDataMap && typeof storyContext.testDataMap === "object" ? storyContext.testDataMap : {};
  const lines = acceptance
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
  const resolvedLines = resolveLinesWithTokens(lines, testDataMap);
  const explicitStoryUrl = extractExplicitNavigateUrl(resolvedLines);
  const searchboxName = inferSearchboxName({ projectContext, testDataMap, explicitStoryUrl, baseUrl });
  const steps = [];
  let preferredAddToCartIndex = resolveConfiguredIndex(testDataMap, [
    "addToCartIndex",
    "add_to_cart_index",
    "addtocartindex",
    "IndexVal",
    "indexVal",
    "index",
  ]);
  const sidebarLabels = [
    "Inputs",
    "Buttons",
    "Checkbox",
    "Select",
    "New tab",
    "Text area",
    "Alerts",
    "Drag and Drop",
    "Iframes",
    "Pop-Up",
    "Text Input",
    "Button",
  ];
  const findSidebarLabel = (raw) => {
    const cleaned = String(raw || "")
      .replace(/\s+text$/i, "")
      .replace(/\s+on\s+the\s+left\s+sidebar$/i, "")
      .replace(/\s+on\s+the\s+page$/i, "")
      .replace(/\.$/, "")
      .trim();
    if (!cleaned) return "";
    const exact = sidebarLabels.find((label) => label.toLowerCase() === cleaned.toLowerCase());
    if (exact) return exact;
    const contains = sidebarLabels.find((label) => cleaned.toLowerCase().includes(label.toLowerCase()));
    return contains || cleaned;
  };
  if (explicitStoryUrl || baseUrl) {
    steps.push({
      name: explicitStoryUrl ? `Navigate to ${explicitStoryUrl}` : "Navigate to configured base URL",
      action: "goto",
      target: { type: "url", value: explicitStoryUrl || baseUrl },
    });
  }
  const seenNavigateUrls = new Set();
  if (explicitStoryUrl) seenNavigateUrls.add(String(explicitStoryUrl).trim().toLowerCase());
  else if (baseUrl) seenNavigateUrls.add(String(baseUrl).trim().toLowerCase());
  for (const rawLine of resolvedLines) {
    const line = String(rawLine || "").trim();
    const lower = line.toLowerCase();
    if (!line) continue;
    if (/^navigate\b|^go to\b|^open\b|^visit\b/.test(lower)) {
      const inlineUrl = extractUrlFromLine(line);
      if (inlineUrl) {
        const key = inlineUrl.toLowerCase();
        if (!seenNavigateUrls.has(key)) {
          steps.push({
            name: `Navigate to ${inlineUrl}`,
            action: "goto",
            target: { type: "url", value: inlineUrl },
          });
          seenNavigateUrls.add(key);
        }
      }
      if (/^open\b.*\bbase url\b/.test(lower) || inlineUrl) continue;
    }
    if (/^scroll\b/.test(lower) && /\badd to cart\b/.test(lower)) {
      const idx = inferOrdinalIndex(line, /add to cart(?:\s+button)?/i);
      if (Number.isInteger(idx) && idx >= 0) {
        preferredAddToCartIndex = idx;
      }
      continue;
    }
    const searchMatch = line.match(/^search\s+for\s+(.+?)\.?$/i);
    if (searchMatch) {
      const query = String(searchMatch[1] || "").trim();
      if (query) {
        steps.push(
          {
            name: `Search for ${query}`,
            action: "fill",
            target: { type: "role", role: "searchbox", name: searchboxName },
            value: query,
          },
          {
            name: "Submit search",
            action: "press",
            value: "Enter",
          },
        );
      }
      continue;
    }
    if (/^add\b.*\bto\s+cart\b/.test(lower)) {
      const inlineIdx =
        inferOrdinalIndex(line, /add to cart(?:\s+button)?/i) ??
        inferOrdinalIndex(line, /item to cart/i) ??
        inferOrdinalIndex(line, /add button/i);
      const resolvedIdx =
        Number.isInteger(inlineIdx) && inlineIdx >= 0
          ? inlineIdx
          : Number.isInteger(preferredAddToCartIndex) && preferredAddToCartIndex >= 0
            ? preferredAddToCartIndex
            : null;
      steps.push({
        name: resolvedIdx !== null ? `Add item to cart (${toOrdinal(resolvedIdx + 1)} match)` : "Add item to cart",
        action: "click",
        target: {
          type: "role",
          role: "button",
          name: "Add to cart",
          ...(resolvedIdx !== null ? { index: resolvedIdx } : {}),
        },
      });
      continue;
    }
    if (/^open\s+cart\b/.test(lower)) {
      steps.push({
        name: "Open cart",
        action: "click",
        target: { type: "role", role: "link", name: "Cart" },
      });
      continue;
    }
    if (/^proceed\s+to\s+checkout\b|^go\s+to\s+checkout\b|^checkout\b/.test(lower)) {
      steps.push({
        name: "Proceed to checkout",
        action: "click",
        target: { type: "role", role: "button", name: "Proceed to checkout" },
      });
      continue;
    }
    const insertMatch = line.match(/insert\s+text\s+(.+?)\s+into\s+(.+?)(?:\s+and\s+press\s+enter.*)?$/i);
    if (insertMatch) {
      const value = String(insertMatch[1] || "").trim();
      const fieldHint = String(insertMatch[2] || "")
        .replace(/\s+input\s+box$/i, "")
        .replace(/^the\s+/i, "")
        .trim();
      steps.push({
        name: `Enter ${value} into ${fieldHint}`,
        action: "fill",
        target: /submit me/i.test(fieldHint)
          ? { type: "placeholder", value: "Submit me" }
          : { type: "label", value: fieldHint },
        value,
      });
      if (/press\s+enter/.test(lower)) {
        steps.push({ name: "Press Enter", action: "press", value: "Enter" });
      }
      continue;
    }
    const verifyTextMatch = line.match(/verify\s+text\s+(.+?)(?:\s+on\s+page)?$/i);
    if (verifyTextMatch) {
      const value = String(verifyTextMatch[1] || "").trim();
      steps.push({
        name: `Verify text ${value}`,
        action: "assertVisible",
        target: { type: "text", value },
      });
      continue;
    }
    if (/^press\b/.test(lower)) {
      const btn = line.match(/press\s+the\s+(.+?)\s+button/i);
      if (btn) {
        steps.push({
          name: `Press ${String(btn[1] || "").trim()} button`,
          action: "click",
          target: { type: "role", role: "button", name: String(btn[1] || "").trim() },
        });
      } else {
        steps.push({ name: line, action: "press", value: "Enter" });
      }
      continue;
    }
    const clickOnMatch = line.match(/click\s+on\s+(.+?)(?:\s+on\s+the\s+page|\s+on\s+the\s+left\s+sidebar)?\.?$/i);
    if (clickOnMatch) {
      const value = String(clickOnMatch[1] || "").trim();
      if (/\badd(?:\s+to\s+cart)?\s+button\b|\badd to cart\b/i.test(value)) {
        const inlineIdx =
          inferOrdinalIndex(line, /add(?: to cart)?(?:\s+button)?/i) ??
          inferOrdinalIndex(value, /add(?: to cart)?(?:\s+button)?/i);
        const resolvedIdx =
          Number.isInteger(inlineIdx) && inlineIdx >= 0
            ? inlineIdx
            : Number.isInteger(preferredAddToCartIndex) && preferredAddToCartIndex >= 0
              ? preferredAddToCartIndex
              : null;
        steps.push({
          name: resolvedIdx !== null ? `Add item to cart (${toOrdinal(resolvedIdx + 1)} match)` : "Add item to cart",
          action: "click",
          target: {
            type: "role",
            role: "button",
            name: "Add to cart",
            ...(resolvedIdx !== null ? { index: resolvedIdx } : {}),
          },
        });
        continue;
      }
      const productResultIdx = inferOrdinalIndex(line, /product result/i);
      if (Number.isInteger(productResultIdx) && productResultIdx >= 0 && /\bproduct result\b/i.test(line)) {
        const productResultName = String(testDataMap?.product_name || testDataMap?.productName || projectContext?.productName || "product")
          .trim();
        steps.push({
          name: `Open ${toOrdinal(productResultIdx + 1)} product result`,
          action: "click",
          target: {
            type: "text",
            value: productResultName || "product result",
            index: productResultIdx,
          },
        });
        continue;
      }
      const sidebarLabel = findSidebarLabel(value);
      const isSidebarIntent = /\bleft\s+sidebar\b/i.test(line) || sidebarLabels.some((x) => x.toLowerCase() === sidebarLabel.toLowerCase());
      steps.push({
        name: `Click ${sidebarLabel || value}`,
        action: "click",
        target: isSidebarIntent
          ? { type: "role", role: "link", name: sidebarLabel || value }
          : { type: "text", value: sidebarLabel || value },
      });
      continue;
    }
    if (/select\b.*checkbox|check\b.*checkbox/.test(lower)) {
      const labelMatch = line.match(/select\s+the\s+(.+?)\s+checkbox/i);
      const name = String(labelMatch?.[1] || "").trim();
      steps.push({
        name: "Select checkbox option",
        action: "click",
        target: { type: "role", role: "checkbox", name },
      });
      continue;
    }
  }
  if (steps.length === 0) {
    return fallbackPlan(userStoryText, projectContext, storyContext);
  }
  return {
    storyName: normalizeStoryName({ userStoryText, storyContext }),
    gherkin: [
      { type: "Given", text: "the user is on the target application page" },
      { type: "When", text: "the user performs intent-driven actions from acceptance criteria" },
      { type: "Then", text: "the expected outcome should be visible" },
    ],
    steps,
    fallbackUsed: true,
    intentModeUsed: "agent-first-safe",
  };
}

function planFromAgentSteps(userStoryText, storyContext = {}) {
  const steps = Array.isArray(storyContext?.agentSteps) ? storyContext.agentSteps : [];
  if (steps.length === 0) return null;
  return {
    storyName: normalizeStoryName({ userStoryText, storyContext }),
    gherkin: [
      { type: "Given", text: "the user is on the target application page" },
      { type: "When", text: "the custom agent steps are executed in sequence" },
      { type: "Then", text: "the expected outcome should be visible" },
    ],
    steps,
    customStepsUsed: true,
  };
}

function applySelectorRegistry(plan, mappings) {
  if (!Array.isArray(plan?.steps)) return plan;
  const byOld = new Map(
    (Array.isArray(mappings) ? mappings : []).map((entry) => [String(entry.oldSelector || ""), String(entry.newSelector || "")]),
  );
  const steps = plan.steps.map((step) => {
    if (step?.target?.type !== "selector") return step;
    const oldValue = String(step.target.value || "");
    const newValue = byOld.get(oldValue);
    if (!newValue) return step;
    return {
      ...step,
      target: { ...step.target, value: newValue },
      _selectorUpgradedFromRegistry: true,
    };
  });
  return { ...plan, steps };
}

export async function buildDynamicPlan({
  userStoryText,
  agentClient,
  selectorMappings = [],
  projectContext = {},
  storyContext = {},
  executionConfig = {},
}) {
  const finalizePlan = (candidatePlan) => {
    const validated = normalizeAndValidatePlan(candidatePlan, {
      defaultStoryName: normalizeStoryName({ userStoryText, storyContext }),
    });
    if (!validated.ok) return null;
    return applySelectorRegistry(validated.plan, selectorMappings);
  };

  const manualPlan = planFromAgentSteps(userStoryText, storyContext);
  if (manualPlan) {
    const finalManual = finalizePlan(manualPlan);
    if (finalManual) return finalManual;
  }
  const intentMode = String(executionConfig?.intentMode || "pattern-safe").trim().toLowerCase();

  const prompt = {
    task: "Convert user story into testable QA plan",
    rules: [
      "Return strict JSON only",
      "Use Gherkin decomposition",
      "Include test-step actions for Playwright test.step",
      "Prefer accessibility locators",
      "Use project context (baseUrl/env/product) if provided",
      "Never include raw secrets in output.",
      "When credentials are needed, use env placeholders such as env:QA_USER and env:QA_PASSWORD in step values.",
    ],
    outputSchema: {
      storyName: "string",
      gherkin: [{ type: "Given|When|Then|And", text: "string" }],
      steps: [
        {
          name: "string",
          action: "goto|click|fill|press|assertVisible|assertUrlIncludes",
          target: "{ type, role?, name?, value?, selector?, index? (0-based) }",
          runWhen: "always|authenticated|unauthenticated (optional)",
          optional: "boolean (optional; when true step is best-effort)",
          delayMs: "number (optional; per-step delay override)",
          value: "string (optional)",
        },
      ],
    },
    userStoryText: String(userStoryText || "").trim(),
    storyContext,
    projectContext,
    selectorRegistry: selectorMappings.slice(0, 200),
  };

  const response = await agentClient.ask({
    message: JSON.stringify(prompt, null, 2),
    expectJson: true,
  });
  if (!response.ok || !response.json) {
    if (intentMode === "agent-first-safe") {
      const intentFallback = finalizePlan(parseAcceptanceIntentSteps({ projectContext, storyContext, userStoryText }));
      if (intentFallback) return intentFallback;
    }
    const deterministicFallback = finalizePlan(fallbackPlan(userStoryText, projectContext, storyContext));
    if (deterministicFallback) return deterministicFallback;
    throw new Error("Planner failed and fallback plan did not pass schema validation.");
  }
  if (!Array.isArray(response.json.steps) || response.json.steps.length === 0) {
    if (intentMode === "agent-first-safe") {
      const intentFallback = finalizePlan(parseAcceptanceIntentSteps({ projectContext, storyContext, userStoryText }));
      if (intentFallback) return intentFallback;
    }
    const deterministicFallback = finalizePlan(fallbackPlan(userStoryText, projectContext, storyContext));
    if (deterministicFallback) return deterministicFallback;
    throw new Error("Planner returned empty steps and fallback plan did not pass schema validation.");
  }
  const responseWithName = {
    ...response.json,
    storyName: String(response.json.storyName || "").trim() || normalizeStoryName({ userStoryText, storyContext }),
  };
  const finalAgentPlan = finalizePlan(responseWithName);
  if (finalAgentPlan) return finalAgentPlan;
  if (intentMode === "agent-first-safe") {
    const intentFallback = finalizePlan(parseAcceptanceIntentSteps({ projectContext, storyContext, userStoryText }));
    if (intentFallback) return intentFallback;
  }
  const deterministicFallback = finalizePlan(fallbackPlan(userStoryText, projectContext, storyContext));
  if (deterministicFallback) return deterministicFallback;
  throw new Error("Agent plan did not pass schema validation and no valid fallback was available.");
}
