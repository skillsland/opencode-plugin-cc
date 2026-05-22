#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { normalizeArgv, parseArgs } from "../lib/args.js";
import { readStdinIfPiped } from "../lib/fs.js";
import {
  collectReviewContext,
  ensureGitRepository,
  resolveReviewTarget,
} from "../lib/git.js";
import type { ReviewTarget } from "../lib/git.js";
import {
  getOpenCodeAuthStatus,
  getOpenCodeAvailability,
  runOpenCode,
} from "../lib/opencode.js";
import {
  binaryAvailable,
  firstNonEmptyLine,
  terminateProcessTree,
} from "../lib/process.js";
import { interpolateTemplate, loadPromptTemplate } from "../lib/prompts.js";
import {
  appendLogLine,
  generateJobId,
  getConfig,
  listJobs,
  nowIso,
  readJobFile,
  resolveJobLogFile,
  setConfig,
  sortJobsNewestFirst,
  upsertJob,
  writeJobFile,
} from "../lib/state.js";
import type { JobRecord } from "../lib/state.js";
import {
  renderCancel,
  renderJobDetails,
  renderQueued,
  renderRunResult,
  renderSetupReport,
  renderStatusTable,
} from "../lib/render.js";
import type { RunResultPayload, SetupReport } from "../lib/render.js";
import { resolveWorkspaceRoot } from "../lib/workspace.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const ROOT_DIR =
  process.env.CLAUDE_PLUGIN_ROOT ?? path.resolve(SCRIPT_DIR, "../..");
const DEFAULT_STATUS_LIMIT = 8;
const VALID_VARIANTS = new Set(["minimal", "low", "medium", "high", "max"]);
const SESSION_ID_ENV = "OPENCODE_COMPANION_SESSION_ID";

type CommandOptions = Record<string, string | boolean>;

type RunRequest = {
  cwd: string;
  kind: JobRecord["kind"];
  title: string;
  summary: string;
  prompt: string;
  targetLabel?: string | undefined;
  model?: string | null | undefined;
  variant?: string | null | undefined;
  agent?: string | null | undefined;
  sessionId?: string | null | undefined;
  continueLast?: boolean | undefined;
  dangerouslySkipPermissions?: boolean | undefined;
};

type StoredRunResult = {
  payload: RunResultPayload;
  rendered: string;
};

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  opencode-companion setup [--enable-review-gate|--disable-review-gate] [--json]",
      "  opencode-companion review [--background] [--base <ref>] [--scope auto|working-tree|branch]",
      "  opencode-companion adversarial-review [--background] [--base <ref>] [focus ...]",
      "  opencode-companion task [--background] [--write] [--resume-last|--resume|--fresh] [--model <provider/model>] [--variant <minimal|low|medium|high|max>] [prompt]",
      "  opencode-companion status [job-id] [--all] [--json]",
      "  opencode-companion result [job-id] [--json]",
      "  opencode-companion cancel [job-id] [--json]",
    ].join("\n"),
  );
}

function asJson(options: CommandOptions): boolean {
  return options.json === true;
}

function optionString(options: CommandOptions, name: string): string | null {
  const value = options[name];
  return typeof value === "string" && value.trim() ? value : null;
}

function output(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(String(value));
}

function parseCommandInput(
  argv: string[],
  config: Parameters<typeof parseArgs>[1] = {},
): ReturnType<typeof parseArgs> {
  return parseArgs(normalizeArgv(argv), {
    ...config,
    aliasMap: {
      m: "model",
      C: "cwd",
      ...(config.aliasMap ?? {}),
    },
  });
}

function resolveCommandCwd(options: CommandOptions): string {
  const cwd = optionString(options, "cwd");
  return cwd ? path.resolve(process.cwd(), cwd) : process.cwd();
}

function normalizeVariant(value: string | null): string | null {
  if (value == null) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!VALID_VARIANTS.has(normalized)) {
    throw new Error(
      `Unsupported OpenCode variant "${value}". Use one of: ${[...VALID_VARIANTS].join(", ")}.`,
    );
  }
  return normalized;
}

function firstLine(text: string, fallback: string): string {
  return firstNonEmptyLine(text) || fallback;
}

function buildSetupReport(cwd: string, actionsTaken: string[]): SetupReport {
  const node = binaryAvailable("node", ["--version"], { cwd });
  const opencode = getOpenCodeAvailability(cwd);
  const auth = opencode.available
    ? getOpenCodeAuthStatus(cwd)
    : {
        loggedIn: false,
        detail: "OpenCode is not installed.",
        credentials: null,
      };
  const config = getConfig(cwd);
  const nextSteps: string[] = [];
  if (!opencode.available) {
    nextSteps.push(
      "Install OpenCode with `curl -fsSL https://opencode.ai/install | bash`.",
    );
  }
  if (opencode.available && !auth.loggedIn) {
    nextSteps.push("Run `!opencode providers login`.");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: run `/opencode:setup --enable-review-gate`.");
  }
  return {
    ready: node.available && opencode.available && auth.loggedIn,
    node,
    opencode,
    auth,
    config,
    actionsTaken,
    nextSteps,
  };
}

function handleSetup(argv: string[]): void {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"],
  });
  if (options["enable-review-gate"] && options["disable-review-gate"]) {
    throw new Error(
      "Choose either --enable-review-gate or --disable-review-gate.",
    );
  }
  const cwd = resolveCommandCwd(options);
  const actionsTaken: string[] = [];
  if (options["enable-review-gate"]) {
    setConfig(cwd, "stopReviewGate", true);
    actionsTaken.push(
      `Enabled the stop-time review gate for ${resolveWorkspaceRoot(cwd)}.`,
    );
  }
  if (options["disable-review-gate"]) {
    setConfig(cwd, "stopReviewGate", false);
    actionsTaken.push(
      `Disabled the stop-time review gate for ${resolveWorkspaceRoot(cwd)}.`,
    );
  }
  const report = buildSetupReport(cwd, actionsTaken);
  output(asJson(options) ? report : renderSetupReport(report), asJson(options));
}

function buildReviewPrompt(
  context: ReturnType<typeof collectReviewContext>,
): string {
  return [
    "You are OpenCode performing a read-only software review.",
    "",
    `Target: ${context.target.label}`,
    context.summary,
    "",
    "Rules:",
    "- Review only. Do not edit files.",
    "- Focus on bugs, regressions, missing tests, and material risks.",
    "- Use file paths and line numbers where possible.",
    "- If no material issues are found, say that clearly and mention residual test risk.",
    "",
    "Repository context:",
    context.content,
  ].join("\n");
}

function buildAdversarialPrompt(
  context: ReturnType<typeof collectReviewContext>,
  focusText: string,
): string {
  return interpolateTemplate(
    loadPromptTemplate(ROOT_DIR, "adversarial-review"),
    {
      TARGET_LABEL: context.target.label,
      USER_FOCUS: focusText || "No extra focus provided.",
      REVIEW_INPUT: context.content,
    },
  );
}

function createJob(request: RunRequest): JobRecord {
  const workspaceRoot = resolveWorkspaceRoot(request.cwd);
  const id = generateJobId(request.kind === "task" ? "task" : "review");
  const logFile = resolveJobLogFile(workspaceRoot, id);
  const timestamp = nowIso();
  return {
    id,
    kind: request.kind,
    title: request.title,
    status: "queued",
    phase: "queued",
    workspaceRoot,
    cwd: request.cwd,
    summary: request.summary,
    createdAt: timestamp,
    updatedAt: timestamp,
    logFile,
    sessionId: process.env[SESSION_ID_ENV] ?? null,
    request,
  };
}

async function executeRun(
  job: JobRecord,
  request: RunRequest,
): Promise<StoredRunResult> {
  const availability = getOpenCodeAvailability(request.cwd);
  if (!availability.available) {
    throw new Error(`${availability.detail} Run /opencode:setup.`);
  }
  appendLogLine(job.logFile, `Starting ${job.title}.`);
  const result = await runOpenCode({
    cwd: request.cwd,
    prompt: request.prompt,
    title: request.title,
    model: request.model,
    variant: request.variant,
    agent: request.agent,
    sessionId: request.sessionId,
    continueLast: request.continueLast,
    dangerouslySkipPermissions: request.dangerouslySkipPermissions,
    onEvent: (event) => {
      appendLogLine(job.logFile, `${event.stream}: ${event.text.trimEnd()}`);
    },
  });
  const payload: RunResultPayload = {
    jobId: job.id,
    title: request.title,
    status: result.status,
    targetLabel: request.targetLabel,
    rawOutput: result.rawOutput,
    stderr: result.stderr,
    sessionId: result.sessionId,
    summary: firstLine(
      result.rawOutput || result.stderr,
      `${request.title} finished.`,
    ),
  };
  return {
    payload,
    rendered: renderRunResult(payload),
  };
}

async function runForeground(
  job: JobRecord,
  request: RunRequest,
  json: boolean,
): Promise<void> {
  upsertJob(job.workspaceRoot, { ...job, status: "running", phase: "running" });
  try {
    const result = await executeRun(job, request);
    const resultFile = writeJobFile(job.workspaceRoot, job.id, result.payload);
    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: result.payload.status === 0 ? "completed" : "failed",
      phase: "finished",
      completedAt: nowIso(),
      resultFile,
      opencodeSessionId: result.payload.sessionId,
      summary: result.payload.summary,
    });
    output(json ? result.payload : result.rendered, json);
    if (result.payload.status !== 0) {
      process.exitCode = result.payload.status;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    upsertJob(job.workspaceRoot, {
      id: job.id,
      status: "failed",
      phase: "failed",
      completedAt: nowIso(),
      errorMessage: message,
    });
    throw error;
  }
}

function spawnWorker(cwd: string, jobId: string): number | null {
  const child = spawn(
    process.execPath,
    [SCRIPT_PATH, "task-worker", "--cwd", cwd, "--job-id", jobId],
    {
      cwd,
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
  return child.pid ?? null;
}

function enqueueBackground(
  job: JobRecord,
  request: RunRequest,
  json: boolean,
): void {
  const pid = spawnWorker(request.cwd, job.id);
  const queued = {
    ...job,
    status: "queued" as const,
    phase: "queued",
    pid,
    request,
  };
  writeJobFile(job.workspaceRoot, job.id, queued);
  upsertJob(job.workspaceRoot, queued);
  output(json ? queued : renderQueued(queued), json);
}

async function handleReviewCommand(
  argv: string[],
  kind: "review" | "adversarial-review",
): Promise<void> {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["base", "scope", "model", "variant", "agent", "cwd"],
    booleanOptions: ["json", "background", "wait"],
  });
  const cwd = resolveCommandCwd(options);
  ensureGitRepository(cwd);
  const target: ReviewTarget = resolveReviewTarget(cwd, {
    base: optionString(options, "base"),
    scope: optionString(options, "scope"),
  });
  const focusText = positionals.join(" ").trim();
  if (kind === "review" && focusText) {
    throw new Error(
      "Use /opencode:adversarial-review when you need custom review focus text.",
    );
  }
  const context = collectReviewContext(cwd, target);
  const request: RunRequest = {
    cwd: context.repoRoot,
    kind,
    title:
      kind === "review" ? "OpenCode Review" : "OpenCode Adversarial Review",
    summary: `${kind} ${target.label}`,
    targetLabel: target.label,
    prompt:
      kind === "review"
        ? buildReviewPrompt(context)
        : buildAdversarialPrompt(context, focusText),
    model: optionString(options, "model"),
    variant: normalizeVariant(optionString(options, "variant")),
    agent: optionString(options, "agent"),
  };
  const job = createJob(request);
  if (options.background) {
    enqueueBackground(job, request, asJson(options));
    return;
  }
  await runForeground(job, request, asJson(options));
}

function readTaskPrompt(
  cwd: string,
  options: CommandOptions,
  positionals: string[],
): string {
  const promptFile = optionString(options, "prompt-file");
  if (promptFile) {
    return fs.readFileSync(path.resolve(cwd, promptFile), "utf8");
  }
  return positionals.join(" ").trim() || readStdinIfPiped();
}

function findLatestTask(cwd: string): JobRecord | null {
  return (
    sortJobsNewestFirst(listJobs(cwd)).find(
      (job) =>
        job.kind === "task" &&
        job.status !== "queued" &&
        job.status !== "running",
    ) ?? null
  );
}

async function handleTask(argv: string[]): Promise<void> {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["model", "variant", "agent", "cwd", "prompt-file"],
    booleanOptions: [
      "json",
      "background",
      "write",
      "resume-last",
      "resume",
      "fresh",
      "dangerously-skip-permissions",
    ],
  });
  const cwd = resolveWorkspaceRoot(resolveCommandCwd(options));
  const prompt = readTaskPrompt(cwd, options, positionals);
  const resume = Boolean(options["resume-last"] ?? options.resume);
  const fresh = Boolean(options.fresh);
  if (resume && fresh) {
    throw new Error("Choose either --resume/--resume-last or --fresh.");
  }
  if (!prompt && !resume) {
    throw new Error(
      "Provide a task prompt, --prompt-file, piped stdin, or --resume-last.",
    );
  }
  const latestTask = resume ? findLatestTask(cwd) : null;
  if (resume && !latestTask?.opencodeSessionId) {
    throw new Error(
      "No previous OpenCode task session was found for this repository.",
    );
  }
  const title = resume ? "OpenCode Resume" : "OpenCode Task";
  const request: RunRequest = {
    cwd,
    kind: "task",
    title,
    summary: prompt || "Continue the latest OpenCode task.",
    prompt: prompt || "Continue the previous task.",
    model: optionString(options, "model"),
    variant: normalizeVariant(optionString(options, "variant")),
    agent: optionString(options, "agent"),
    sessionId: latestTask?.opencodeSessionId ?? null,
    continueLast: resume && !latestTask?.opencodeSessionId,
    dangerouslySkipPermissions: Boolean(
      options["dangerously-skip-permissions"],
    ),
  };
  const job = createJob(request);
  if (options.background) {
    enqueueBackground(job, request, asJson(options));
    return;
  }
  await runForeground(job, request, asJson(options));
}

async function handleTaskWorker(argv: string[]): Promise<void> {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd", "job-id"],
  });
  const cwd = resolveCommandCwd(options);
  const jobId = optionString(options, "job-id");
  if (!jobId) {
    throw new Error("Missing --job-id.");
  }
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stored = readJobFile(workspaceRoot, jobId) as JobRecord | null;
  if (
    !stored ||
    typeof stored.request !== "object" ||
    stored.request === null
  ) {
    throw new Error(`No runnable stored job found for ${jobId}.`);
  }
  const request = stored.request as RunRequest;
  await runForeground(
    {
      ...stored,
      workspaceRoot,
      cwd: request.cwd,
    },
    request,
    true,
  );
}

function resolveJob(cwd: string, reference: string): JobRecord {
  const jobs = sortJobsNewestFirst(listJobs(cwd));
  if (!reference) {
    const job = jobs[0];
    if (!job) {
      throw new Error("No OpenCode jobs found for this repository.");
    }
    return job;
  }
  const job = jobs.find((candidate) => candidate.id === reference);
  if (!job) {
    throw new Error(`No OpenCode job found for ${reference}.`);
  }
  return job;
}

function handleStatus(argv: string[]): void {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "all"],
  });
  const cwd = resolveCommandCwd(options);
  if (positionals[0]) {
    const job = resolveJob(cwd, positionals[0]);
    output(asJson(options) ? job : renderStatusTable([job]), asJson(options));
    return;
  }
  const jobs = sortJobsNewestFirst(listJobs(cwd));
  const visible = options.all ? jobs : jobs.slice(0, DEFAULT_STATUS_LIMIT);
  output(
    asJson(options) ? visible : renderStatusTable(visible),
    asJson(options),
  );
}

function handleResult(argv: string[]): void {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"],
  });
  const cwd = resolveCommandCwd(options);
  const job = resolveJob(cwd, positionals[0] ?? "");
  const payload: unknown =
    job.resultFile && fs.existsSync(job.resultFile)
      ? (JSON.parse(fs.readFileSync(job.resultFile, "utf8")) as unknown)
      : { error: job.errorMessage ?? "No stored result is available.", job };
  output(
    asJson(options) ? payload : renderJobDetails(job, payload),
    asJson(options),
  );
}

function handleTaskResumeCandidate(argv: string[]): void {
  const { options } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"],
  });
  const cwd = resolveCommandCwd(options);
  const candidate = findLatestTask(cwd);
  const payload = {
    available: Boolean(candidate?.opencodeSessionId),
    candidate,
  };
  output(
    asJson(options)
      ? payload
      : candidate
        ? `Resumable OpenCode task found: ${candidate.id}.\n`
        : "No resumable OpenCode task found for this repository.\n",
    asJson(options),
  );
}

function handleCancel(argv: string[]): void {
  const { options, positionals } = parseCommandInput(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"],
  });
  const cwd = resolveCommandCwd(options);
  const job = resolveJob(cwd, positionals[0] ?? "");
  const interrupted = terminateProcessTree(job.pid);
  const next = upsertJob(job.workspaceRoot, {
    id: job.id,
    status: "cancelled",
    phase: "cancelled",
    pid: null,
    completedAt: nowIso(),
    errorMessage: "Cancelled by user.",
  });
  appendLogLine(job.logFile, "Cancelled by user.");
  output(
    asJson(options) ? next : renderCancel(next, interrupted),
    asJson(options),
  );
}

async function main(): Promise<void> {
  const [subcommand, ...argv] = process.argv.slice(2);
  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printUsage();
    return;
  }
  switch (subcommand) {
    case "setup":
      handleSetup(argv);
      break;
    case "review":
      await handleReviewCommand(argv, "review");
      break;
    case "adversarial-review":
      await handleReviewCommand(argv, "adversarial-review");
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "status":
      handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "cancel":
      handleCancel(argv);
      break;
    default:
      throw new Error(`Unknown subcommand: ${subcommand}`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
