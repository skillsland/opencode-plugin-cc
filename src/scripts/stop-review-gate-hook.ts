#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getConfig } from "../lib/state.js";
import { resolveWorkspaceRoot } from "../lib/workspace.js";
import { getOpenCodeAvailability } from "../lib/opencode.js";
import { interpolateTemplate, loadPromptTemplate } from "../lib/prompts.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ROOT_DIR =
  process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(SCRIPT_DIR, "../..");
const COMPANION_SCRIPT = path.join(SCRIPT_DIR, "opencode-companion.mjs");
const STOP_TIMEOUT_MS = 15 * 60 * 1000;

function readHookInput(): Record<string, unknown> {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function emitBlock(reason: string): void {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
}

function buildPrompt(input: Record<string, unknown>): string {
  const lastAssistantMessage =
    typeof input.last_assistant_message === "string"
      ? input.last_assistant_message.trim()
      : "";
  return interpolateTemplate(loadPromptTemplate(ROOT_DIR, "stop-review-gate"), {
    CLAUDE_RESPONSE_BLOCK: lastAssistantMessage
      ? `Previous Claude response:\n${lastAssistantMessage}`
      : "",
  });
}

function parseStopOutput(raw: string): { allow: boolean; reason: string } {
  const text = raw.trim();
  if (!text) {
    return { allow: false, reason: "OpenCode stop review returned no output." };
  }
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (firstLine.startsWith("ALLOW:")) {
    return { allow: true, reason: firstLine.slice("ALLOW:".length).trim() };
  }
  if (firstLine.startsWith("BLOCK:")) {
    return {
      allow: false,
      reason: firstLine.slice("BLOCK:".length).trim() || text,
    };
  }
  return {
    allow: false,
    reason: "OpenCode stop review returned an unexpected answer.",
  };
}

function main(): void {
  const input = readHookInput();
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  if (!getConfig(workspaceRoot).stopReviewGate) {
    return;
  }
  const availability = getOpenCodeAvailability(cwd);
  if (!availability.available) {
    process.stderr.write(`${availability.detail} Run /opencode:setup.\n`);
    return;
  }
  const prompt = buildPrompt(input);
  const result = spawnSync(
    process.execPath,
    [COMPANION_SCRIPT, "task", "--json", prompt],
    {
      cwd,
      env: process.env,
      encoding: "utf8",
      timeout: STOP_TIMEOUT_MS,
    },
  );
  if (result.error) {
    emitBlock(result.error.message);
    return;
  }
  if (result.status !== 0) {
    emitBlock(
      (result.stderr || result.stdout || "OpenCode stop review failed.").trim(),
    );
    return;
  }
  try {
    const payload = JSON.parse(result.stdout) as { rawOutput?: string };
    const decision = parseStopOutput(payload.rawOutput ?? "");
    if (!decision.allow) {
      emitBlock(
        `OpenCode stop-time review blocked session end: ${decision.reason}`,
      );
    }
  } catch {
    emitBlock("OpenCode stop review returned invalid JSON.");
  }
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
