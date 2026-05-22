import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ensureDir, readJsonFile, writeJsonFile } from "./fs.js";
import { resolveWorkspaceRoot } from "./workspace.js";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type CompanionConfig = {
  stopReviewGate: boolean;
};

export type JobRecord = {
  id: string;
  kind: "review" | "adversarial-review" | "task" | "stop-review";
  title: string;
  status: JobStatus;
  phase: string;
  workspaceRoot: string;
  cwd: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  pid?: number | null;
  logFile?: string;
  resultFile?: string;
  sessionId?: string | null;
  opencodeSessionId?: string | null;
  errorMessage?: string;
  request?: unknown;
};

export type CompanionState = {
  version: 1;
  config: CompanionConfig;
  jobs: JobRecord[];
};

const PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const STATE_VERSION = 1;
const MAX_JOBS = 50;
const FALLBACK_STATE_ROOT = path.join(os.tmpdir(), "opencode-companion");

export function nowIso(): string {
  return new Date().toISOString();
}

function defaultState(): CompanionState {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false,
    },
    jobs: [],
  };
}

export function resolveStateDir(cwd: string): string {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const canonicalWorkspaceRoot = (() => {
    try {
      return fs.realpathSync.native(workspaceRoot);
    } catch {
      return workspaceRoot;
    }
  })();
  const basename = path.basename(workspaceRoot) || "workspace";
  const slug =
    basename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "workspace";
  const hash = createHash("sha256")
    .update(canonicalWorkspaceRoot)
    .digest("hex")
    .slice(0, 16);
  const root = process.env[PLUGIN_DATA_ENV]
    ? path.join(process.env[PLUGIN_DATA_ENV], "state")
    : FALLBACK_STATE_ROOT;
  return path.join(root, `${slug}-${hash}`);
}

export function resolveStateFile(cwd: string): string {
  return path.join(resolveStateDir(cwd), "state.json");
}

export function resolveJobsDir(cwd: string): string {
  return path.join(resolveStateDir(cwd), "jobs");
}

export function resolveJobFile(cwd: string, jobId: string): string {
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}

export function resolveJobLogFile(cwd: string, jobId: string): string {
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function ensureStateDir(cwd: string): void {
  ensureDir(resolveJobsDir(cwd));
}

export function loadState(cwd: string): CompanionState {
  const loaded = readJsonFile<Partial<CompanionState>>(
    resolveStateFile(cwd),
    {},
  );
  const fallback = defaultState();
  return {
    version: STATE_VERSION,
    config: {
      ...fallback.config,
      ...(loaded.config ?? {}),
    },
    jobs: Array.isArray(loaded.jobs) ? loaded.jobs : [],
  };
}

function pruneJobs(jobs: JobRecord[]): JobRecord[] {
  return [...jobs]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_JOBS);
}

export function saveState(cwd: string, state: CompanionState): CompanionState {
  ensureStateDir(cwd);
  const next = {
    version: STATE_VERSION,
    config: {
      ...defaultState().config,
      ...state.config,
    },
    jobs: pruneJobs(state.jobs),
  } satisfies CompanionState;
  writeJsonFile(resolveStateFile(cwd), next);
  return next;
}

export function updateState(
  cwd: string,
  mutate: (state: CompanionState) => void,
): CompanionState {
  const state = loadState(cwd);
  mutate(state);
  return saveState(cwd, state);
}

export function generateJobId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function listJobs(cwd: string): JobRecord[] {
  return loadState(cwd).jobs;
}

export function sortJobsNewestFirst(jobs: JobRecord[]): JobRecord[] {
  return [...jobs].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function upsertJob(
  cwd: string,
  patch: Partial<JobRecord> & { id: string },
): JobRecord {
  const timestamp = nowIso();
  let nextJob: JobRecord | undefined;
  updateState(cwd, (state) => {
    const index = state.jobs.findIndex((job) => job.id === patch.id);
    if (index === -1) {
      nextJob = {
        kind: "task",
        title: "OpenCode Task",
        status: "queued",
        phase: "queued",
        workspaceRoot: resolveWorkspaceRoot(cwd),
        cwd,
        summary: "",
        createdAt: timestamp,
        updatedAt: timestamp,
        ...patch,
      };
      state.jobs.unshift(nextJob);
      return;
    }
    const existing = state.jobs[index];
    if (!existing) {
      throw new Error(`State index disappeared for job ${patch.id}.`);
    }
    nextJob = {
      ...existing,
      ...patch,
      updatedAt: timestamp,
    };
    state.jobs[index] = nextJob;
  });
  if (nextJob === undefined) {
    throw new Error(`Failed to upsert job ${patch.id}.`);
  }
  return nextJob;
}

export function getConfig(cwd: string): CompanionConfig {
  return loadState(cwd).config;
}

export function setConfig(
  cwd: string,
  key: keyof CompanionConfig,
  value: boolean,
): void {
  updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value,
    };
  });
}

export function writeJobFile(
  cwd: string,
  jobId: string,
  payload: unknown,
): string {
  const jobFile = resolveJobFile(cwd, jobId);
  writeJsonFile(jobFile, payload);
  return jobFile;
}

export function readJobFile(cwd: string, jobId: string): unknown {
  const jobFile = resolveJobFile(cwd, jobId);
  if (!fs.existsSync(jobFile)) {
    return null;
  }
  return readJsonFile<unknown>(jobFile, null);
}

export function appendLogLine(
  logFile: string | undefined,
  message: string,
): void {
  if (!logFile) {
    return;
  }
  ensureDir(path.dirname(logFile));
  fs.appendFileSync(logFile, `${nowIso()} ${message}\n`, "utf8");
}
