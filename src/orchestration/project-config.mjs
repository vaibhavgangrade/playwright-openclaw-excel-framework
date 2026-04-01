import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = {
  projectName: "default-project",
  agentId: "qa-oracle",
  maxAttempts: 3,
  context: {
    baseUrl: "",
    productName: "",
    environment: "",
    auth: {
      mode: "env",
      usernameEnv: "QA_USER",
      passwordEnv: "QA_PASSWORD",
    },
  },
  paths: {
    artifactsDir: "artifacts",
    reportsDir: "reports",
    testsDir: "tests",
    generatedTestFile: "tests/generated-story.spec.js",
    selectorRegistryFile: "artifacts/selector-registry.json",
    evidenceDir: "artifacts/evidence",
    executionOutputDir: "artifacts/execution",
  },
  execution: {
    manualReview: false,
    engine: "openclaw-first",
    openclawStrict: false,
    intentMode: "pattern-safe",
    actionDelayMs: 500,
    verboseStepLogs: true,
    openclawProfile: "openclaw",
    openclawClearCookiesOnStart: false,
    openclawBootstrapCookies: [],
    openclawLiveAiActionResolution: false,
  },
};

function mergeDeep(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key] && typeof base[key] === "object") {
      out[key] = mergeDeep(base[key], value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function loadProjectConfig(configFileArg) {
  const configFile = String(configFileArg || "test-config/qa-oracle.config.json").trim();
  const absolutePath = path.resolve(process.cwd(), configFile);
  try {
    const raw = await readFile(absolutePath, "utf8");
    const parsed = JSON.parse(raw);
    const merged = mergeDeep(DEFAULT_CONFIG, parsed);
    return { config: merged, configPath: absolutePath };
  } catch {
    return { config: DEFAULT_CONFIG, configPath: "" };
  }
}

export function toAbsolute(projectConfig, relativePath) {
  return path.resolve(process.cwd(), String(relativePath || ""));
}
