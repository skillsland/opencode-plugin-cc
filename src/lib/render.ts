import type { Availability } from "./process.js";
import type { CompanionConfig, JobRecord } from "./state.js";

export type SetupReport = {
  ready: boolean;
  node: Availability;
  opencode: Availability;
  auth: {
    loggedIn: boolean;
    detail: string;
    credentials: number | null;
  };
  config: CompanionConfig;
  actionsTaken: string[];
  nextSteps: string[];
};

export type RunResultPayload = {
  jobId: string;
  title: string;
  status: number;
  targetLabel?: string | undefined;
  rawOutput: string;
  stderr: string;
  sessionId: string | null;
  summary: string;
};

function statusIcon(ok: boolean): string {
  return ok ? "OK" : "NOT READY";
}

export function renderSetupReport(report: SetupReport): string {
  const lines = [
    `OpenCode companion setup: ${statusIcon(report.ready)}`,
    "",
    `- Node: ${report.node.detail}`,
    `- OpenCode: ${report.opencode.detail}`,
    `- Auth: ${report.auth.loggedIn ? "configured" : "missing"}${
      report.auth.credentials == null
        ? ""
        : ` (${String(report.auth.credentials)} credential(s))`
    }`,
    `- Review gate: ${report.config.stopReviewGate ? "enabled" : "disabled"}`,
  ];
  if (report.actionsTaken.length > 0) {
    lines.push(
      "",
      "Actions:",
      ...report.actionsTaken.map((action) => `- ${action}`),
    );
  }
  if (report.nextSteps.length > 0) {
    lines.push(
      "",
      "Next steps:",
      ...report.nextSteps.map((step) => `- ${step}`),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function renderRunResult(payload: RunResultPayload): string {
  const lines = [`# ${payload.title}`];
  if (payload.targetLabel) {
    lines.push("", `Target: ${payload.targetLabel}`);
  }
  lines.push(
    "",
    payload.rawOutput || payload.stderr || "(OpenCode returned no output.)",
  );
  if (payload.sessionId) {
    lines.push("", `OpenCode session: ${payload.sessionId}`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderQueued(job: JobRecord): string {
  return `${job.title} started in the background as ${job.id}. Check /opencode:status ${job.id} for progress.\n`;
}

function compact(text: string | undefined, fallback = ""): string {
  const normalized = (text ?? fallback).trim().replace(/\s+/g, " ");
  return normalized.length > 100 ? `${normalized.slice(0, 97)}...` : normalized;
}

export function renderStatusTable(jobs: JobRecord[]): string {
  if (jobs.length === 0) {
    return "No OpenCode jobs found for this repository.\n";
  }
  const rows = [
    "| Job | Kind | Status | Phase | Summary |",
    "| --- | --- | --- | --- | --- |",
    ...jobs.map(
      (job) =>
        `| ${job.id} | ${job.kind} | ${job.status} | ${job.phase} | ${compact(job.summary)} |`,
    ),
  ];
  return `${rows.join("\n")}\n`;
}

export function renderJobDetails(job: JobRecord, result: unknown): string {
  const lines = [
    `# ${job.title}`,
    "",
    `- Job: ${job.id}`,
    `- Kind: ${job.kind}`,
    `- Status: ${job.status}`,
    `- Phase: ${job.phase}`,
  ];
  if (job.opencodeSessionId) {
    lines.push(`- OpenCode session: ${job.opencodeSessionId}`);
  }
  if (job.logFile) {
    lines.push(`- Log: ${job.logFile}`);
  }
  lines.push("", "## Result", "", JSON.stringify(result, null, 2));
  return `${lines.join("\n")}\n`;
}

export function renderCancel(job: JobRecord, interrupted: boolean): string {
  return `Cancelled ${job.id} (${job.title}). Process signal sent: ${String(interrupted)}.\n`;
}
