import { describe, expect, it } from "vitest";

import { normalizeArgv, parseArgs, splitRawArgumentString } from "./args.js";

describe("args", () => {
  it("splits quoted raw argument strings", () => {
    expect(splitRawArgumentString('--base main "focus on auth"')).toEqual([
      "--base",
      "main",
      "focus on auth",
    ]);
  });

  it("parses value options, boolean options, and aliases", () => {
    const parsed = parseArgs(
      ["-m", "anthropic/claude", "--background", "fix it"],
      {
        valueOptions: ["model"],
        booleanOptions: ["background"],
        aliasMap: { m: "model" },
      },
    );
    expect(parsed.options).toEqual({
      model: "anthropic/claude",
      background: true,
    });
    expect(parsed.positionals).toEqual(["fix it"]);
  });

  it("normalizes Claude Code single raw argument style", () => {
    expect(normalizeArgv(["--scope working-tree --background"])).toEqual([
      "--scope",
      "working-tree",
      "--background",
    ]);
  });
});
