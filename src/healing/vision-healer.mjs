import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function clip(text, size = 10000) {
  return String(text || "").slice(0, size);
}

async function fileExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export class VisionHealer {
  constructor({
    agentClient,
    selectorRegistry,
    evidenceDir = path.resolve(process.cwd(), process.env.QA_ORACLE_EVIDENCE_DIR || "artifacts/evidence"),
  }) {
    this.agentClient = agentClient;
    this.selectorRegistry = selectorRegistry;
    this.evidenceDir = path.resolve(evidenceDir);
  }

  async healLocator({ page, storyName, pageName, stepName, oldSelector, errorMessage }) {
    await mkdir(this.evidenceDir, { recursive: true });
    const baseName = `${Date.now()}-${this.#safe(storyName)}-${this.#safe(stepName)}`;
    const failureImagePath = path.resolve(this.evidenceDir, `${baseName}-failed.png`);
    const domPath = path.resolve(this.evidenceDir, `${baseName}-dom.html`);
    const baselinePath = path.resolve(this.evidenceDir, `${this.#safe(storyName)}-last-pass.png`);

    await page.screenshot({ path: failureImagePath, fullPage: true });
    const domSnapshot = await page.content();
    await writeFile(domPath, domSnapshot, "utf8");

    const baselineAvailable = await fileExists(baselinePath);
    const baselineContent = baselineAvailable ? await readFile(baselinePath) : null;
    const failureContent = await readFile(failureImagePath);
    const simpleVisualSimilarity = baselineContent
      ? this.#computeBytePrefixSimilarity(baselineContent, failureContent)
      : 0.5;

    const prompt = {
      task: "Self-heal failing Playwright locator",
      oldSelector: String(oldSelector || ""),
      errorMessage: String(errorMessage || ""),
      pageName: String(pageName || ""),
      stepName: String(stepName || ""),
      visual: {
        failureScreenshotPath: failureImagePath,
        baselineScreenshotPath: baselineAvailable ? baselinePath : null,
        simpleSimilarity: simpleVisualSimilarity,
      },
      domSnapshotPath: domPath,
      domSnapshotExcerpt: clip(domSnapshot, 12000),
      instructions:
        "Return strict JSON only: { newSelector, confidence, reason }. Prefer accessibility locators (role/label/text). confidence must be 0..1.",
    };

    const agentResponse = await this.agentClient.ask({
      message: JSON.stringify(prompt, null, 2),
      expectJson: true,
    });

    if (!agentResponse.ok || !agentResponse.json) {
      return {
        healed: false,
        confidence: 0,
        reason: `Agent heal failed: ${agentResponse.stderr || agentResponse.text}`,
        failureImagePath,
        baselinePath: baselineAvailable ? baselinePath : "",
      };
    }

    const newSelector = String(agentResponse.json.newSelector || "").trim();
    const confidence = Number(agentResponse.json.confidence || 0);
    const reason = String(agentResponse.json.reason || "Vision-based locator update");
    if (!newSelector) {
      return { healed: false, confidence, reason: "Agent returned empty selector", failureImagePath };
    }

    if (confidence < 0.8) {
      const accepted = await this.#askHumanApproval({
        oldSelector,
        newSelector,
        confidence,
        reason,
      });
      if (!accepted) {
        return {
          healed: false,
          confidence,
          reason: `Human rejected low-confidence fix (${reason})`,
          proposedSelector: newSelector,
          failureImagePath,
        };
      }
    }

    await this.selectorRegistry.upsertMapping({
      storyName,
      pageName,
      stepName,
      oldSelector,
      newSelector,
      reason,
      confidence,
    });

    return {
      healed: true,
      oldSelector,
      newSelector,
      confidence,
      reason,
      failureImagePath,
      baselinePath: baselineAvailable ? baselinePath : "",
    };
  }

  async savePassingScreenshot({ page, storyName }) {
    await mkdir(this.evidenceDir, { recursive: true });
    const baselinePath = path.resolve(this.evidenceDir, `${this.#safe(storyName)}-last-pass.png`);
    await page.screenshot({ path: baselinePath, fullPage: true });
    return baselinePath;
  }

  #safe(text) {
    return String(text || "story")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/--+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  }

  #computeBytePrefixSimilarity(a, b) {
    const min = Math.min(a.length, b.length);
    if (min <= 0) return 0;
    let same = 0;
    for (let i = 0; i < min; i += 1) {
      if (a[i] === b[i]) same += 1;
    }
    return Math.max(0, Math.min(1, same / min));
  }

  async #askHumanApproval({ oldSelector, newSelector, confidence, reason }) {
    const rl = readline.createInterface({ input, output });
    try {
      const answer = await rl.question(
        [
          "",
          "[Healer] Low confidence fix detected (<80%).",
          `Old Selector: ${oldSelector}`,
          `Suggested: ${newSelector}`,
          `Confidence: ${(confidence * 100).toFixed(1)}%`,
          `Reason: ${reason}`,
          "Apply this heal? (y/n): ",
        ].join("\n"),
      );
      const normalized = String(answer || "").trim().toLowerCase();
      return normalized === "y" || normalized === "yes";
    } finally {
      rl.close();
    }
  }
}
