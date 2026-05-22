import path from "node:path";

import { runCommand } from "./process.js";

export function resolveWorkspaceRoot(cwd: string): string {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd });
  if (!result.error && result.status === 0 && result.stdout.trim()) {
    return path.resolve(result.stdout.trim());
  }
  return path.resolve(cwd);
}
