import fs from "node:fs";
import path from "node:path";

import { isProbablyText } from "./fs.js";
import {
  formatCommandFailure,
  runCommand,
  runCommandChecked,
} from "./process.js";

export type ReviewScope = "auto" | "working-tree" | "branch";

export type ReviewTarget =
  | {
      mode: "working-tree";
      label: string;
      explicit: boolean;
    }
  | {
      mode: "branch";
      label: string;
      baseRef: string;
      explicit: boolean;
    };

export type ReviewContext = {
  repoRoot: string;
  target: ReviewTarget;
  summary: string;
  content: string;
  changedFiles: string[];
};

const MAX_UNTRACKED_BYTES = 24 * 1024;

function git(cwd: string, args: string[]) {
  return runCommand("git", args, { cwd });
}

function gitChecked(cwd: string, args: string[]) {
  return runCommandChecked("git", args, { cwd });
}

function splitLines(text: string): string[] {
  return text
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function uniqueSorted(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].sort();
}

function section(title: string, body: string): string {
  return [`## ${title}`, "", body.trim() || "(none)", ""].join("\n");
}

export function ensureGitRepository(cwd: string): string {
  const result = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (
    result.error &&
    "code" in result.error &&
    result.error.code === "ENOENT"
  ) {
    throw new Error("git is not installed. Install Git and retry.");
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error("This command must run inside a Git repository.");
  }
  return result.stdout.trim();
}

export function getRepoRoot(cwd: string): string {
  return gitChecked(cwd, ["rev-parse", "--show-toplevel"]).stdout.trim();
}

export function getWorkingTreeState(cwd: string): {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  isDirty: boolean;
} {
  const staged = splitLines(
    gitChecked(cwd, ["diff", "--cached", "--name-only"]).stdout,
  );
  const unstaged = splitLines(gitChecked(cwd, ["diff", "--name-only"]).stdout);
  const untracked = splitLines(
    gitChecked(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout,
  );
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length > 0 || unstaged.length > 0 || untracked.length > 0,
  };
}

export function detectDefaultBranch(cwd: string): string {
  const symbolic = git(cwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (symbolic.status === 0) {
    const value = symbolic.stdout.trim();
    if (value.startsWith("refs/remotes/origin/")) {
      return value.replace("refs/remotes/origin/", "");
    }
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (
      git(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`])
        .status === 0
    ) {
      return candidate;
    }
    if (
      git(cwd, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/remotes/origin/${candidate}`,
      ]).status === 0
    ) {
      return `origin/${candidate}`;
    }
  }
  throw new Error("Unable to detect the default branch. Pass --base <ref>.");
}

export function resolveReviewTarget(
  cwd: string,
  options: { base?: string | null; scope?: string | null } = {},
): ReviewTarget {
  ensureGitRepository(cwd);
  const scope = options.scope ?? "auto";
  if (options.base) {
    return {
      mode: "branch",
      label: `branch diff against ${options.base}`,
      baseRef: options.base,
      explicit: true,
    };
  }
  if (scope === "working-tree") {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: true,
    };
  }
  if (scope !== "auto" && scope !== "branch") {
    throw new Error(
      'Unsupported review scope. Use "auto", "working-tree", or "branch".',
    );
  }
  if (scope === "auto" && getWorkingTreeState(cwd).isDirty) {
    return {
      mode: "working-tree",
      label: "working tree diff",
      explicit: false,
    };
  }
  const baseRef = detectDefaultBranch(cwd);
  return {
    mode: "branch",
    label: `branch diff against ${baseRef}`,
    baseRef,
    explicit: scope === "branch",
  };
}

function formatUntrackedFile(cwd: string, relativePath: string): string {
  const absolutePath = path.join(cwd, relativePath);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return `### ${relativePath}\n(skipped: unreadable file)`;
  }
  if (stat.isDirectory()) {
    return `### ${relativePath}\n(skipped: directory)`;
  }
  if (stat.size > MAX_UNTRACKED_BYTES) {
    return `### ${relativePath}\n(skipped: ${String(stat.size)} bytes exceeds ${String(MAX_UNTRACKED_BYTES)})`;
  }
  const buffer = fs.readFileSync(absolutePath);
  if (!isProbablyText(buffer)) {
    return `### ${relativePath}\n(skipped: binary file)`;
  }
  return [
    `### ${relativePath}`,
    "```",
    buffer.toString("utf8").trimEnd(),
    "```",
  ].join("\n");
}

function buildBranchComparison(
  cwd: string,
  baseRef: string,
): {
  mergeBase: string;
  commitRange: string;
} {
  const mergeBaseResult = git(cwd, ["merge-base", "HEAD", baseRef]);
  if (mergeBaseResult.status !== 0) {
    throw new Error(formatCommandFailure(mergeBaseResult));
  }
  const mergeBase = mergeBaseResult.stdout.trim();
  return {
    mergeBase,
    commitRange: `${mergeBase}..HEAD`,
  };
}

export function collectReviewContext(
  cwd: string,
  target: ReviewTarget,
): ReviewContext {
  const repoRoot = getRepoRoot(cwd);
  if (target.mode === "working-tree") {
    const state = getWorkingTreeState(repoRoot);
    const changedFiles = uniqueSorted(
      state.staged,
      state.unstaged,
      state.untracked,
    );
    const untracked = state.untracked
      .map((file) => formatUntrackedFile(repoRoot, file))
      .join("\n\n");
    return {
      repoRoot,
      target,
      summary: `Reviewing ${String(state.staged.length)} staged, ${String(state.unstaged.length)} unstaged, and ${String(state.untracked.length)} untracked file(s).`,
      changedFiles,
      content: [
        section(
          "Git Status",
          gitChecked(repoRoot, ["status", "--short", "--untracked-files=all"])
            .stdout,
        ),
        section(
          "Staged Diff",
          gitChecked(repoRoot, [
            "diff",
            "--cached",
            "--binary",
            "--no-ext-diff",
          ]).stdout,
        ),
        section(
          "Unstaged Diff",
          gitChecked(repoRoot, ["diff", "--binary", "--no-ext-diff"]).stdout,
        ),
        section("Untracked Files", untracked),
      ].join("\n"),
    };
  }

  const comparison = buildBranchComparison(repoRoot, target.baseRef);
  const changedFiles = splitLines(
    gitChecked(repoRoot, ["diff", "--name-only", comparison.commitRange])
      .stdout,
  );
  return {
    repoRoot,
    target,
    changedFiles,
    summary: `Reviewing branch diff against ${target.baseRef} from merge-base ${comparison.mergeBase}.`,
    content: [
      section(
        "Commit Log",
        gitChecked(repoRoot, ["log", "--oneline", comparison.commitRange])
          .stdout,
      ),
      section(
        "Diff Stat",
        gitChecked(repoRoot, ["diff", "--stat", comparison.commitRange]).stdout,
      ),
      section(
        "Branch Diff",
        gitChecked(repoRoot, [
          "diff",
          "--binary",
          "--no-ext-diff",
          comparison.commitRange,
        ]).stdout,
      ),
    ].join("\n"),
  };
}
