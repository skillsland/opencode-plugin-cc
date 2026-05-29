import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type PackageJson = {
  name: string;
  version: string;
};

type PluginJson = {
  name: string;
  version: string;
};

type MarketplaceJson = {
  metadata: {
    version: string;
  };
  plugins: {
    name: string;
    version: string;
    source: {
      source: string;
      package: string;
    };
  }[];
};

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("Claude Code plugin files", () => {
  it("exposes the expected commands", () => {
    expect(fs.readdirSync(path.join(ROOT, "commands")).sort()).toEqual([
      "adversarial-review.md",
      "cancel.md",
      "rescue.md",
      "result.md",
      "review.md",
      "setup.md",
      "status.md",
    ]);
  });

  it("keeps review commands review-only and background-capable", () => {
    const review = read("commands/review.md");
    const adversarial = read("commands/adversarial-review.md");
    for (const source of [review, adversarial]) {
      expect(source).toMatch(/review-only/i);
      expect(source).toMatch(/run_in_background:\s*true/);
      expect(source).toMatch(/Return the command stdout verbatim/i);
      expect(source).toMatch(/dist\/scripts\/opencode-companion\.mjs/);
      expect(source).toMatch(/AskUserQuestion/);
    }
  });

  it("keeps rescue as a thin forwarding wrapper", () => {
    const rescue = read("commands/rescue.md");
    const agent = read("agents/opencode-rescue.md");
    const skill = read("skills/opencode-cli-runtime/SKILL.md");
    expect(rescue).toMatch(/subagent_type: "opencode:opencode-rescue"/);
    expect(agent).toMatch(/thin forwarding wrapper/i);
    expect(agent).toMatch(/Use exactly one `Bash` call/i);
    expect(skill).toMatch(/Your only job is to invoke `task` once/i);
    expect(skill).toMatch(/Never add `--dangerously-skip-permissions`/i);
  });

  it("wires session lifecycle and stop review hooks", () => {
    const hooks = read("hooks/hooks.json");
    expect(hooks).toMatch(/SessionStart/);
    expect(hooks).toMatch(/SessionEnd/);
    expect(hooks).toMatch(/Stop/);
    expect(hooks).toMatch(/stop-review-gate-hook\.mjs/);
  });

  it("keeps published package and marketplace versions in sync", () => {
    const packageJson = JSON.parse(read("package.json")) as PackageJson;
    const pluginJson = JSON.parse(
      read(".claude-plugin/plugin.json"),
    ) as PluginJson;
    const marketplaceJson = JSON.parse(
      read(".claude-plugin/marketplace.json"),
    ) as MarketplaceJson;
    const marketplacePlugin = marketplaceJson.plugins.find(
      (plugin) => plugin.name === pluginJson.name,
    );

    expect(pluginJson.version).toBe(packageJson.version);
    expect(marketplaceJson.metadata.version).toBe(packageJson.version);
    expect(marketplacePlugin).toMatchObject({
      name: pluginJson.name,
      version: packageJson.version,
      source: {
        source: "npm",
        package: packageJson.name,
      },
    });
  });
});
