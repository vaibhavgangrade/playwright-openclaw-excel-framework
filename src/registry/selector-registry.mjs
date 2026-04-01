import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_REGISTRY_PATH = path.resolve(process.cwd(), "artifacts", "selector-registry.json");

function nowIso() {
  return new Date().toISOString();
}

export class SelectorRegistry {
  constructor(registryPath = DEFAULT_REGISTRY_PATH) {
    this.registryPath = path.resolve(registryPath);
  }

  async load() {
    try {
      const raw = await readFile(this.registryPath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        updatedAt: parsed.updatedAt || "",
        mappings: Array.isArray(parsed.mappings) ? parsed.mappings : [],
      };
    } catch {
      return { updatedAt: "", mappings: [] };
    }
  }

  async resolveSelector(candidate) {
    const original = String(candidate || "").trim();
    if (!original) return "";
    const data = await this.load();
    const match = data.mappings.find((entry) => entry.oldSelector === original);
    return match?.newSelector || original;
  }

  async upsertMapping({
    storyName,
    pageName,
    stepName,
    oldSelector,
    newSelector,
    reason,
    confidence,
  }) {
    const oldValue = String(oldSelector || "").trim();
    const newValue = String(newSelector || "").trim();
    if (!oldValue || !newValue) return;

    const data = await this.load();
    const index = data.mappings.findIndex((entry) => entry.oldSelector === oldValue);
    const record = {
      oldSelector: oldValue,
      newSelector: newValue,
      reason: String(reason || "locator healed"),
      confidence: Number(confidence || 0),
      storyName: String(storyName || ""),
      pageName: String(pageName || ""),
      stepName: String(stepName || ""),
      healedAt: nowIso(),
    };

    if (index >= 0) data.mappings[index] = record;
    else data.mappings.push(record);

    data.updatedAt = nowIso();
    await mkdir(path.dirname(this.registryPath), { recursive: true });
    await writeFile(this.registryPath, JSON.stringify(data, null, 2), "utf8");
  }
}

export { DEFAULT_REGISTRY_PATH };
