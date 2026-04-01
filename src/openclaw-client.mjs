import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const NODE_CMD = process.platform === "win32" ? "node.exe" : "node";

function extractJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!(line.startsWith("{") || line.startsWith("["))) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}

function isJsonSuccess(payload) {
  if (payload === true) return true;
  if (!payload || typeof payload !== "object") return false;
  if (payload.ok === true) return true;
  if (payload.result === true) return true;
  if (payload.value === true) return true;
  if (payload?.result?.ok === true) return true;
  if (payload?.value?.ok === true) return true;
  return false;
}

export async function readOpenClawConfig() {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw);
}

export class OpenClawClient {
  constructor(rootDir, token, profile = "openclaw") {
    this.token = token;
    this.profile = profile;
    this.entry = path.resolve(rootDir, "node_modules", "openclaw", "openclaw.mjs");
    this.maxGatewayRetries = 2;
  }

  async browser(args, { json = true, timeoutMs = 45000 } = {}) {
    const base = [this.entry, "browser"];
    if (json) base.push("--json");
    base.push("--timeout", String(Math.max(30000, Number(timeoutMs) || 30000)));
    base.push("--browser-profile", this.profile);
    if (this.token) base.push("--token", this.token);
    base.push(...args);
    let lastResult = null;
    for (let attempt = 0; attempt <= this.maxGatewayRetries; attempt += 1) {
      const result = await this.#run(base, timeoutMs, json);
      lastResult = result;
      if (result.ok) return result;
      if (!this.#isGatewayTimeout(result)) return result;
      if (attempt < this.maxGatewayRetries) await this.#wait(1200 * (attempt + 1));
    }
    return lastResult;
  }

  async #run(args, timeoutMs, wantJson) {
    return new Promise((resolve) => {
      const child = spawn(NODE_CMD, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      child.stdout.on("data", (c) => (stdout += String(c)));
      child.stderr.on("data", (c) => (stderr += String(c)));
      child.on("close", (code) => {
        clearTimeout(timer);
        const parsedJson = wantJson ? extractJson(stdout) : null;
        const ok = code === 0 || (wantJson && isJsonSuccess(parsedJson));
        resolve({
          ok,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          json: parsedJson,
        });
      });
    });
  }

  #isGatewayTimeout(result) {
    const text = `${result?.stdout || ""}\n${result?.stderr || ""}`.toLowerCase();
    return text.includes("gateway timeout");
  }

  async #wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
