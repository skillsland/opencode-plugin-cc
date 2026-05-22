import { spawn, spawnSync } from "node:child_process";
import type { SpawnOptions, SpawnSyncReturns } from "node:child_process";
import process from "node:process";

export type CommandResult = SpawnSyncReturns<string>;

export type CommandRunOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  maxBuffer?: number;
  timeoutMs?: number;
};

export type Availability = {
  available: boolean;
  command: string;
  detail: string;
  version?: string;
};

export type StreamEvent = {
  stream: "stdout" | "stderr";
  text: string;
};

export function runCommand(
  command: string,
  args: string[] = [],
  options: CommandRunOptions = {},
): CommandResult {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    input: options.input,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    timeout: options.timeoutMs,
  });
}

export function runCommandChecked(
  command: string,
  args: string[] = [],
  options: CommandRunOptions = {},
): CommandResult {
  const result = runCommand(command, args, options);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(formatCommandFailure(result));
  }
  return result;
}

export function binaryAvailable(
  command: string,
  versionArgs: string[] = ["--version"],
  options: CommandRunOptions = {},
): Availability {
  const result = runCommand(command, versionArgs, {
    ...options,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
  if (result.error) {
    const code =
      "code" in result.error ? String(result.error.code) : result.error.message;
    return {
      available: false,
      command,
      detail:
        code === "ENOENT"
          ? `${command} was not found on PATH.`
          : result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      available: false,
      command,
      detail: formatCommandFailure(result),
    };
  }
  const version =
    firstNonEmptyLine(result.stdout) || firstNonEmptyLine(result.stderr);
  return {
    available: true,
    command,
    detail: version ? `${command} ${version}` : `${command} is available.`,
    version,
  };
}

export function formatCommandFailure(result: CommandResult): string {
  const detail = [result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .trim();
  return detail || `Command failed with status ${String(result.status)}.`;
}

export function firstNonEmptyLine(text: string | null | undefined): string {
  return (
    (text ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function terminateProcessTree(pid: number | null | undefined): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(-pid, "SIGTERM");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}

export async function runStreamingCommand(
  command: string,
  args: string[],
  options: SpawnOptions & {
    input?: string;
    onEvent?: (event: StreamEvent) => void;
  } = {},
): Promise<{ status: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      options.onEvent?.({ stream: "stdout", text: chunk });
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      options.onEvent?.({ stream: "stderr", text: chunk });
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        status: code ?? 1,
        stdout,
        stderr,
      });
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}
