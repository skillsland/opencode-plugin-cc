import { runCommand, runStreamingCommand, stripAnsi } from "./process.js";
import type { Availability, StreamEvent } from "./process.js";

export const DEFAULT_OPENCODE_AGENT = "build";

export type OpenCodeRunRequest = {
  cwd: string;
  prompt: string;
  title: string;
  model?: string | null | undefined;
  variant?: string | null | undefined;
  agent?: string | null | undefined;
  sessionId?: string | null | undefined;
  continueLast?: boolean | undefined;
  dangerouslySkipPermissions?: boolean | undefined;
  onEvent?: ((event: StreamEvent) => void) | undefined;
};

export type OpenCodeRunResult = {
  status: number;
  stdout: string;
  stderr: string;
  rawOutput: string;
  sessionId: string | null;
};

export type OpenCodeAuthStatus = {
  loggedIn: boolean;
  detail: string;
  credentials: number | null;
};

export function getOpenCodeAvailability(cwd: string): Availability {
  const result = runCommand("opencode", ["--version"], {
    cwd,
    timeoutMs: 10_000,
  });
  if (result.error) {
    const detail =
      "code" in result.error && result.error.code === "ENOENT"
        ? "opencode was not found on PATH."
        : result.error.message;
    return {
      available: false,
      command: "opencode",
      detail,
    };
  }
  if (result.status !== 0) {
    return {
      available: false,
      command: "opencode",
      detail:
        stripAnsi(result.stderr || result.stdout).trim() ||
        "opencode --version failed.",
    };
  }
  const version = stripAnsi(result.stdout || result.stderr).trim();
  return {
    available: true,
    command: "opencode",
    version,
    detail: version ? `opencode ${version}` : "opencode is available.",
  };
}

export function getOpenCodeAuthStatus(cwd: string): OpenCodeAuthStatus {
  const result = runCommand("opencode", ["providers", "list"], {
    cwd,
    timeoutMs: 15_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) {
    return {
      loggedIn: false,
      detail: result.error.message,
      credentials: null,
    };
  }
  const output = stripAnsi(
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  const match = /(\d+)\s+credentials?/i.exec(output);
  const credentials = match ? Number(match[1]) : null;
  return {
    loggedIn: result.status === 0 && (credentials == null || credentials > 0),
    detail:
      output.trim() ||
      (result.status === 0
        ? "Provider list succeeded."
        : "Provider list failed."),
    credentials,
  };
}

function pushIfValue(
  args: string[],
  flag: string,
  value: string | null | undefined,
): void {
  if (value) {
    args.push(flag, value);
  }
}

function parseSessionId(output: string): string | null {
  const patterns = [
    /session(?:ID|Id| id)?["':\s]+([a-zA-Z0-9._:-]+)/i,
    /"sessionID"\s*:\s*"([^"]+)"/i,
    /"sessionId"\s*:\s*"([^"]+)"/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

export async function runOpenCode(
  request: OpenCodeRunRequest,
): Promise<OpenCodeRunResult> {
  const args = ["run", "--dir", request.cwd, "--title", request.title];
  pushIfValue(args, "--model", request.model);
  pushIfValue(args, "--variant", request.variant);
  pushIfValue(
    args,
    "--agent",
    request.agent ??
      process.env.OPENCODE_COMPANION_DEFAULT_AGENT ??
      DEFAULT_OPENCODE_AGENT,
  );
  if (request.sessionId) {
    args.push("--session", request.sessionId);
  } else if (request.continueLast) {
    args.push("--continue");
  }
  if (request.dangerouslySkipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  args.push(request.prompt);

  const runOptions: Parameters<typeof runStreamingCommand>[2] = {
    cwd: request.cwd,
    env: process.env,
  };
  if (request.onEvent) {
    runOptions.onEvent = request.onEvent;
  }
  const result = await runStreamingCommand("opencode", args, runOptions);
  const rawOutput = [result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
  return {
    ...result,
    rawOutput,
    sessionId: parseSessionId(rawOutput),
  };
}
