import { spawn } from "node:child_process";

function safeJsonParse(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch {}
  const lines = source.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}

export class OpenClawAgentClient {
  constructor({ agentId = "qa-oracle", timeoutMs = 90000 } = {}) {
    this.agentId = agentId;
    this.timeoutMs = timeoutMs;
  }

  async ask({ message, expectJson = true }) {
    const baseArgs = ["openclaw", "agent", "--agent", this.agentId, "--message", String(message || "")];
    const command = process.platform === "win32" ? "cmd.exe" : "npx";
    const args =
      process.platform === "win32"
        ? ["/d", "/s", "/c", `"npx ${baseArgs.map((part) => this.#q(part)).join(" ")}"`]
        : baseArgs;
    return new Promise((resolve) => {
      const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => child.kill("SIGTERM"), this.timeoutMs);
      child.stdout.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr.on("data", (chunk) => (stderr += String(chunk)));
      child.on("close", (code) => {
        clearTimeout(timer);
        const text = stdout.trim() || stderr.trim();
        resolve({
          ok: code === 0,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          text,
          json: expectJson ? safeJsonParse(text) : null,
        });
      });
    });
  }

  #q(value) {
    return `"${String(value || "").replace(/"/g, '\\"')}"`;
  }
}
