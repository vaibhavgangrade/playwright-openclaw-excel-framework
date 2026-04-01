import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

function playwrightNodeCliForCwd(cwd) {
  return path.resolve(cwd, "node_modules", "playwright", "cli.js");
}

function runCommand(command, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("close", (code) => {
      resolve({ code, ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function extractFailureHints(jsonReport) {
  const hints = [];
  const collectSuite = (suite) => {
    const specs = Array.isArray(suite.specs) ? suite.specs : [];
    for (const spec of specs) {
      const tests = Array.isArray(spec.tests) ? spec.tests : [];
      for (const test of tests) {
        const results = Array.isArray(test.results) ? test.results : [];
        for (const result of results) {
          if (result.status === "passed") continue;
          const errors = Array.isArray(result.errors) ? result.errors : [];
          for (const error of errors) {
            const message = String(error?.message || "").trim();
            if (!message) continue;
            hints.push({
              testTitle: String(test.title || spec.title || ""),
              message,
            });
          }
        }
      }
    }

    const childSuites = Array.isArray(suite.suites) ? suite.suites : [];
    for (const child of childSuites) collectSuite(child);
  };

  const suites = Array.isArray(jsonReport?.suites) ? jsonReport.suites : [];
  for (const suite of suites) collectSuite(suite);

  const topLevelErrors = Array.isArray(jsonReport?.errors) ? jsonReport.errors : [];
  for (const entry of topLevelErrors) {
    const message = String(entry?.message || "").trim();
    if (!message) continue;
    hints.push({ testTitle: "top-level", message });
  }

  return hints;
}

export async function runExecutionSkill({
  cwd = process.cwd(),
  testFile = "tests/generated-story.spec.js",
  retries = 0,
  reporter = "line,json",
  outputRoot = "artifacts/execution",
} = {}) {
  const absoluteOutputRoot = path.resolve(cwd, outputRoot);
  await mkdir(absoluteOutputRoot, { recursive: true });
  const stamp = Date.now().toString(36);
  const jsonReportPath = path.resolve(absoluteOutputRoot, `playwright-report-${stamp}.json`);
  const normalizedTestFile = String(testFile || "").replace(/\\/g, "/");

  const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonReportPath };
  const cliArgs = [
    "test",
    normalizedTestFile,
    "--trace",
    "on",
    "--retries",
    String(retries),
    "--output",
    path.resolve(absoluteOutputRoot, "test-results"),
    "--reporter",
    reporter,
  ];
  const command = process.execPath;
  const args = [playwrightNodeCliForCwd(cwd), ...cliArgs];

  const commandResult = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("close", (code) => {
      resolve({ code, ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });

  let failureHints = [];
  try {
    const reportRaw = await readFile(jsonReportPath, "utf8");
    const report = JSON.parse(reportRaw);
    failureHints = extractFailureHints(report);
  } catch {
    // Reporter can still fail; command logs remain fallback source.
  }

  const llmFailureContext = {
    ok: commandResult.ok,
    code: commandResult.code,
    failureHints,
    stderr: commandResult.stderr,
    stdoutTail: commandResult.stdout.slice(-5000),
    reportPath: jsonReportPath,
  };

  return {
    ...commandResult,
    reportPath: jsonReportPath,
    llmFailureContext,
  };
}

export async function checkPlaywrightInstalled(cwd = process.cwd()) {
  return runCommand(process.execPath, [playwrightNodeCliForCwd(cwd), "--version"], cwd);
}
