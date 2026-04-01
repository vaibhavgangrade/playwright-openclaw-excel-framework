import { readFile } from "node:fs/promises";
import path from "node:path";

function normalizeLines(raw) {
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");
}

function parseMarkdownSections(lines) {
  const sections = [];
  let current = { heading: "intro", body: [] };

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      sections.push(current);
      current = { heading: heading[1].trim(), body: [] };
      continue;
    }
    current.body.push(line);
  }
  sections.push(current);
  return sections.filter((section) => section.body.length > 0 || section.heading !== "intro");
}

function findSection(sections, names) {
  const wanted = names.map((name) => String(name || "").toLowerCase());
  return (
    sections.find((section) => wanted.includes(String(section.heading || "").toLowerCase())) || {
      heading: "",
      body: [],
    }
  );
}

function compact(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function parseOrList(text) {
  return String(text || "")
    .split(/\s+or\s+/i)
    .map((part) => part.replace(/^[-*\d.)\s]+/, "").trim())
    .filter(Boolean);
}

function extractAuthRules({ userStory, acceptanceCriteria, notes }) {
  const lines = [userStory, acceptanceCriteria, notes]
    .filter(Boolean)
    .join("\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let authenticatedAny = [];
  let unauthenticatedAny = [];
  let conditionalAuthDetected = false;

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      /already\s+authenticated|not\s+authenticated|skip\s+login|unauthenticated\s+indicator|authenticated\s+indicator/.test(
        lower,
      )
    ) {
      conditionalAuthDetected = true;
    }
    if (lower.includes("authenticated indicators:") || lower.includes("authenticated when:")) {
      const rhs = line.split(":").slice(1).join(":").trim();
      authenticatedAny = parseOrList(rhs);
    }
    if (lower.includes("unauthenticated indicators:") || lower.includes("unauthenticated when:")) {
      const rhs = line.split(":").slice(1).join(":").trim();
      unauthenticatedAny = parseOrList(rhs);
    }

    // Support natural phrasing:
    // "If unauthenticated indicator is present (Hello, Sign in OR Sign in OR Login), ..."
    // "If authenticated indicator is present (Profile OR Sign Out), ..."
    const unauthPhrase = line.match(/unauthenticated\s+indicator[s]?\s+is\s+present\s*\(([^)]+)\)/i);
    if (unauthPhrase && unauthPhrase[1]) {
      unauthenticatedAny = parseOrList(unauthPhrase[1]);
    }
    const authPhrase = line.match(/authenticated\s+indicator[s]?\s+is\s+present\s*\(([^)]+)\)/i);
    if (authPhrase && authPhrase[1]) {
      authenticatedAny = parseOrList(authPhrase[1]);
    }
  }

  return { authenticatedAny, unauthenticatedAny, conditionalAuthDetected };
}

function parseAgentStepsFromSection(rawSectionText) {
  const text = String(rawSectionText || "").trim();
  if (!text) return [];

  const codeFence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeFence && codeFence[1]) {
    try {
      const parsed = JSON.parse(codeFence[1].trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseTestDataMap(rawTestDataText) {
  const out = {};
  const lines = String(rawTestDataText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s+/, "");
    const separatorIndex = cleaned.indexOf(":") >= 0 ? cleaned.indexOf(":") : cleaned.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = cleaned
      .slice(0, separatorIndex)
      .trim()
      .replace(/\s+/g, "_");
    const value = cleaned.slice(separatorIndex + 1).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

export async function loadStoryFromFile(storyFilePath) {
  const absolutePath = path.resolve(process.cwd(), String(storyFilePath || "").trim());
  const raw = await readFile(absolutePath, "utf8");
  const lines = normalizeLines(raw);
  const sections = parseMarkdownSections(lines);

  const titleSection = sections.find((section) => section.heading && section.heading !== "intro");
  const title = (titleSection?.heading || path.basename(absolutePath)).trim();
  const userStory = compact(
    findSection(sections, ["User Story", "Story", "Narrative"]).body.join("\n") ||
      findSection(sections, ["intro"]).body.join("\n"),
  );
  const acceptanceCriteria = compact(
    findSection(sections, ["Acceptance Criteria", "Acceptance", "Criteria"]).body.join("\n"),
  );
  const testData = compact(findSection(sections, ["Test Data", "Data", "Inputs"]).body.join("\n"));
  const testDataMap = parseTestDataMap(testData);
  const notes = compact(findSection(sections, ["Notes", "Constraints", "Out of Scope"]).body.join("\n"));
  const authRules = extractAuthRules({ userStory, acceptanceCriteria, notes });
  const agentStepsRaw = findSection(sections, ["Agent Steps", "Execution Steps", "Automation Steps"]).body.join("\n");
  const agentSteps = parseAgentStepsFromSection(agentStepsRaw);

  const combinedText = [
    `Story Title: ${title}`,
    userStory ? `User Story:\n${userStory}` : "",
    acceptanceCriteria ? `Acceptance Criteria:\n${acceptanceCriteria}` : "",
    testData ? `Test Data:\n${testData}` : "",
    notes ? `Notes:\n${notes}` : "",
    Object.keys(testDataMap).length > 0 ? `Test Data Map JSON:\n${JSON.stringify(testDataMap, null, 2)}` : "",
    authRules.authenticatedAny.length > 0
      ? `Authenticated indicators: ${authRules.authenticatedAny.join(" OR ")}`
      : "",
    authRules.unauthenticatedAny.length > 0
      ? `Unauthenticated indicators: ${authRules.unauthenticatedAny.join(" OR ")}`
      : "",
    agentSteps.length > 0 ? `Agent Steps JSON:\n${JSON.stringify(agentSteps, null, 2)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    sourcePath: absolutePath,
    title,
    userStory,
    acceptanceCriteria,
    testData,
    testDataMap,
    notes,
    authRules,
    agentSteps,
    combinedText,
  };
}
