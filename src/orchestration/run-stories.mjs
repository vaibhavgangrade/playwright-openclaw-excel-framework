import { readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { loadEnvFiles, parseArgs } from "../utils.mjs";

const TAG = "[QA-Oracle Batch]";

function isStoryFile(filePath) {
  const name = path.basename(String(filePath || "")).toLowerCase();
  return name.endsWith(".story.md") || name.endsWith(".story.markdown") || name.endsWith(".story.txt");
}

async function collectStoryFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const absolute = path.resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectStoryFiles(absolute);
      out.push(...nested);
      continue;
    }
    if (entry.isFile() && isStoryFile(absolute)) {
      out.push(absolute);
    }
  }
  return out;
}

function runNodeScript(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", shell: false });
    child.on("exit", (code) => resolve(Number(code || 0)));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  await loadEnvFiles();
  const args = parseArgs(process.argv);
  const configPath = path.resolve(process.cwd(), String(args.config || "test-config/qa-oracle.config.json"));
  const storiesDir = path.resolve(process.cwd(), String(args.storiesDir || "stories"));
  const autoApprove = String(args.autoApprove ?? "true").trim().toLowerCase() !== "false";
  const continueOnError = String(args.continueOnError ?? "true").trim().toLowerCase() !== "false";

  const storyFiles = (await collectStoryFiles(storiesDir)).sort((a, b) => a.localeCompare(b));
  if (storyFiles.length === 0) {
    console.error(`${TAG} No story files found in ${storiesDir}. Expected *.story.md|*.story.markdown|*.story.txt`);
    process.exit(1);
  }

  console.log(`${TAG} Config: ${configPath}`);
  console.log(`${TAG} Stories directory: ${storiesDir}`);
  console.log(`${TAG} Found ${storyFiles.length} story file(s).`);

  let passed = 0;
  let failed = 0;
  for (const storyFile of storyFiles) {
    console.log(`${TAG} Running story: ${storyFile}`);
    const forwardArgs = [];
    if (args.engine) forwardArgs.push("--engine", String(args.engine));
    if (args.maxAttempts) forwardArgs.push("--maxAttempts", String(args.maxAttempts));
    if (args.manualReview) forwardArgs.push("--manualReview", String(args.manualReview));
    if (args.agent) forwardArgs.push("--agent", String(args.agent));
    if (autoApprove) forwardArgs.push("--autoApprove", "true");

    const code = await runNodeScript(["src/orchestration/run-story.mjs", configPath, storyFile, ...forwardArgs]);
    if (code === 0) {
      passed += 1;
      continue;
    }
    failed += 1;
    if (!continueOnError) {
      console.error(`${TAG} Stopping early because continueOnError=false.`);
      break;
    }
  }

  console.log(`${TAG} Done. Passed=${passed}, Failed=${failed}, Total=${passed + failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`${TAG} Fatal: ${error?.message || error}`);
  process.exit(1);
});
