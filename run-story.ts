/**
 * Entry wrapper for teams that prefer a TypeScript-named launcher.
 * Delegates to the JavaScript runtime implementation at src/orchestration/run-story.mjs.
 *
 * Example:
 *   node --loader ts-node/esm run-story.ts --story "As a shopper, I can place an order"
 */
import { spawn } from "node:child_process";

const NODE = process.platform === "win32" ? "node.exe" : "node";
const args = ["src/orchestration/run-story.mjs", ...process.argv.slice(2)];

const child = spawn(NODE, args, { stdio: "inherit", shell: false });
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
