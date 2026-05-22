import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  generateJobId,
  getConfig,
  listJobs,
  readJobFile,
  resolveStateDir,
  setConfig,
  upsertJob,
  writeJobFile,
} from "./state.js";

function withPluginData<T>(fn: (dir: string) => T): T {
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-plugin-state-"));
  process.env.CLAUDE_PLUGIN_DATA = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previous;
    }
  }
}

describe("state", () => {
  it("stores config and jobs under plugin data", () => {
    withPluginData((dir) => {
      const cwd = fs.mkdtempSync(
        path.join(os.tmpdir(), "opencode-plugin-work-"),
      );
      setConfig(cwd, "stopReviewGate", true);
      expect(getConfig(cwd).stopReviewGate).toBe(true);
      expect(resolveStateDir(cwd)).toContain(dir);

      const id = generateJobId("task");
      const job = upsertJob(cwd, {
        id,
        kind: "task",
        title: "OpenCode Task",
        status: "queued",
        phase: "queued",
        workspaceRoot: cwd,
        cwd,
        summary: "check",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      expect(job.id).toBe(id);
      expect(listJobs(cwd)).toHaveLength(1);

      writeJobFile(cwd, id, { ok: true });
      expect(readJobFile(cwd, id)).toEqual({ ok: true });
    });
  });
});
