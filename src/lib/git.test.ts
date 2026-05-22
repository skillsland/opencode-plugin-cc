import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { collectReviewContext, resolveReviewTarget } from "./git.js";

function makeTempRepo(): string {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-plugin-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repo,
  });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });
  fs.writeFileSync(path.join(repo, "README.md"), "hello\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repo });
  return repo;
}

describe("git review context", () => {
  it("uses working tree target when auto scope sees local changes", () => {
    const repo = makeTempRepo();
    fs.writeFileSync(path.join(repo, "README.md"), "hello world\n", "utf8");

    const target = resolveReviewTarget(repo);
    expect(target.mode).toBe("working-tree");

    const context = collectReviewContext(repo, target);
    expect(context.content).toContain("Unstaged Diff");
    expect(context.changedFiles).toContain("README.md");
  });

  it("uses explicit branch target with base ref", () => {
    const repo = makeTempRepo();
    execFileSync("git", ["checkout", "-b", "feature"], {
      cwd: repo,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(repo, "feature.txt"), "feature\n", "utf8");
    execFileSync("git", ["add", "feature.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "feature"], { cwd: repo });

    const target = resolveReviewTarget(repo, { base: "main" });
    expect(target.mode).toBe("branch");
    expect(target.label).toContain("main");

    const context = collectReviewContext(repo, target);
    expect(context.content).toContain("Commit Log");
    expect(context.changedFiles).toEqual(["feature.txt"]);
  });
});
