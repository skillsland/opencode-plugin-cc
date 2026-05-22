#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { listJobs, upsertJob } from "../lib/state.js";
import { terminateProcessTree } from "../lib/process.js";
import { resolveWorkspaceRoot } from "../lib/workspace.js";

const SESSION_ID_ENV = "OPENCODE_COMPANION_SESSION_ID";
const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

function readHookInput(): Record<string, unknown> {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function appendEnvVar(name: string, value: string | undefined): void {
  if (!process.env.CLAUDE_ENV_FILE || !value) {
    return;
  }
  fs.appendFileSync(
    process.env.CLAUDE_ENV_FILE,
    `export ${name}=${shellEscape(value)}\n`,
    "utf8",
  );
}

function cleanupSession(cwd: string, sessionId: string | null): void {
  if (!sessionId) {
    return;
  }
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  for (const job of listJobs(workspaceRoot)) {
    if (job.sessionId !== sessionId) {
      continue;
    }
    if (job.status === "queued" || job.status === "running") {
      terminateProcessTree(job.pid);
      upsertJob(workspaceRoot, {
        id: job.id,
        status: "cancelled",
        phase: "session-ended",
        pid: null,
        errorMessage: "Claude session ended.",
      });
    }
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function main(): void {
  const input = readHookInput();
  const eventName = process.argv[2] ?? getString(input.hook_event_name) ?? "";
  if (eventName === "SessionStart") {
    const sessionId = getString(input.session_id);
    appendEnvVar(SESSION_ID_ENV, sessionId);
    appendEnvVar(PLUGIN_DATA_ENV, process.env[PLUGIN_DATA_ENV]);
    return;
  }
  if (eventName === "SessionEnd") {
    const cwd = getString(input.cwd) ?? process.cwd();
    const sessionId =
      getString(input.session_id) ?? process.env[SESSION_ID_ENV] ?? null;
    cleanupSession(cwd, sessionId);
  }
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
