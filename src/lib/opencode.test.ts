import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  getOpenCodeAuthStatus,
  getOpenCodeAvailability,
  runOpenCode,
} from "./opencode.js";

function withFakeOpenCode<T>(fn: (cwd: string) => T | Promise<T>): Promise<T> {
  const previousPath = process.env.PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-plugin-fake-"));
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir);
  const executable = path.join(binDir, "opencode");
  fs.writeFileSync(
    executable,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args.includes('--version')) { console.log('9.9.9'); process.exit(0); }",
      "if (args[0] === 'providers' && args[1] === 'list') { console.log('└  1 credentials'); process.exit(0); }",
      "if (args[0] === 'run') { console.log('OpenCode args: ' + JSON.stringify(args)); console.log('OpenCode handled: ' + args[args.length - 1]); console.log('sessionId: fake-session'); process.exit(0); }",
      "console.error('unexpected args ' + JSON.stringify(args));",
      "process.exit(1);",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(executable, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${previousPath ?? ""}`;
  return Promise.resolve()
    .then(() => fn(root))
    .finally(() => {
      if (previousPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = previousPath;
      }
    });
}

describe("opencode CLI wrapper", () => {
  it("detects availability and credentials", async () => {
    await withFakeOpenCode((cwd) => {
      expect(getOpenCodeAvailability(cwd)).toMatchObject({
        available: true,
        version: "9.9.9",
      });
      expect(getOpenCodeAuthStatus(cwd)).toMatchObject({
        loggedIn: true,
        credentials: 1,
      });
    });
  });

  it("runs opencode and captures output plus session id", async () => {
    await withFakeOpenCode(async (cwd) => {
      const result = await runOpenCode({
        cwd,
        title: "Test",
        prompt: "inspect this",
      });
      expect(result.status).toBe(0);
      expect(result.rawOutput).toContain("OpenCode handled: inspect this");
      expect(result.rawOutput).toContain('"--agent","build"');
      expect(result.sessionId).toBe("fake-session");
    });
  });

  it("preserves an explicit agent override", async () => {
    await withFakeOpenCode(async (cwd) => {
      const result = await runOpenCode({
        cwd,
        title: "Test",
        prompt: "inspect this",
        agent: "plan",
      });
      expect(result.status).toBe(0);
      expect(result.rawOutput).toContain('"--agent","plan"');
    });
  });
});
